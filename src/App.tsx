// App.tsx（差分反映版：履歴をpayloadに入れる）
// 必要なパッケージをインポート
import { useState, useRef, useEffect, type FormEvent } from 'react';
import { fetchAuthSession } from 'aws-amplify/auth';
import ReactMarkdown from 'react-markdown';
import './App.css';
import './kizunavi_animation.css';
import './kizunavi_icon.css';
// 画像インポート
import kizunavi_body from '../assets/kizunavi_body.png';
import kizunavi_head from '../assets/kizunavi_head.png';
import kizunavi_left from '../assets/kizunavi_left.png';
import kizunavi_right from '../assets/kizunavi_rigth.png';

// 環境変数から設定を取得
const AGENT_ARN = import.meta.env.VITE_AGENT_ARN;
const AGREED_KEY = "kizunavi_agreed_v1";

// チャットメッセージの型定義
interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isToolUsing?: boolean;
  toolCompleted?: boolean;
  toolName?: string;
  avatarPulse?: 'greet' | 'answer' | 'thinking' | null; // キズナビ君の状態
}

// ★ 追加：バックに渡す履歴の型
type HistoryItem = {
  role: 'user' | 'assistant';
  content: string;
};

// ★ 追加：履歴生成（直近N件・tool/空除外）
const buildHistory = (msgs: Message[], maxItems = 20): HistoryItem[] => {
  const cleaned = msgs
    .filter(m => !m.isToolUsing)                 // tool statusは会話履歴に入れない
    .map(m => ({ role: m.role, content: (m.content || '').trim() }))
    .filter(m => m.content.length > 0);

  // 末尾からmaxItems件
  return cleaned.slice(Math.max(cleaned.length - maxItems, 0));
};

// キズナビ君同意文
const AGREE_MESSAGE =` こんにちは！ぼくはキズナビだよ。
ぼくはNotionに書いてくれた、みんなの経歴が情報源になっているんだ！
質問をする前に、君の経歴はちゃんと記入してくれているかな？
ぼくを成長させるためにも、しっかりと入力をしてから質問してね！

`

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const [agreed, setAgreed] = useState(false);
  const [agreeChecked, setAgreeChecked] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(AGREED_KEY) === "true";
    setAgreed(saved);
    setAgreeChecked(saved);
  }, []);

  const onAgreeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.checked;
    setAgreeChecked(v);

    if (v) {
      localStorage.setItem(AGREED_KEY, "true");
      setAgreed(true);
    } else {
      localStorage.removeItem(AGREED_KEY);
      setAgreed(false);
    }
  };

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!agreed) return;
    if (!input.trim() || loading) return;

    // ユーザーメッセージを作成
    const userMessage: Message = { id: crypto.randomUUID(), role: 'user', content: input.trim() };

    // ★ 追加：送信前のmessages + 今回ユーザ発言までを履歴化（placeholderは入れない）
    const history: HistoryItem[] = buildHistory([...messages, userMessage], 20);

    // メッセージ配列に追加（ユーザー発言 + 空のAI応答）
    setMessages(prev => [
      ...prev,
      userMessage,
      { id: crypto.randomUUID(), role: 'assistant', content: '', avatarPulse: 'thinking' }
    ]);
    setInput('');
    setLoading(true);

    // Cognito認証トークンを取得
    const session = await fetchAuthSession();
    const accessToken = session.tokens?.accessToken?.toString();

    // AgentCore Runtime APIを呼び出し
    const url = `https://bedrock-agentcore.ap-northeast-1.amazonaws.com/runtimes/${encodeURIComponent(AGENT_ARN)}/invocations?qualifier=DEFAULT`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      // ★ 変更：promptに加えてhistoryを渡す
      body: JSON.stringify({
        prompt: userMessage.content,
        history,
      }),
    });

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let isInToolUse = false;
    let toolIdx = -1;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      for (const line of decoder.decode(value, { stream: true }).split('\n')) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6);
        if (data === '[DONE]') continue;
        const event = JSON.parse(data);

        if (event.type === 'tool_use') {
          isInToolUse = true;
          const savedBuffer = buffer;
          setMessages(prev => {
            const msgs = [...prev];
            if (savedBuffer) {
              msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], content: savedBuffer };
              toolIdx = msgs.length;
              msgs.push({ id: crypto.randomUUID(), role: 'assistant', content: '', isToolUsing: true, toolName: event.tool_name, avatarPulse: 'thinking' });
            } else {
              toolIdx = msgs.length - 1;
              msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], isToolUsing: true, toolName: event.tool_name };
            }
            return msgs;
          });
          buffer = '';
          continue;
        }

        if (event.type === 'text' && event.data) {
          if (isInToolUse && !buffer) {
            const savedIdx = toolIdx;
            setMessages(prev => {
              const msgs = [...prev];
              if (savedIdx >= 0 && savedIdx < msgs.length){
                msgs[savedIdx] = { ...msgs[savedIdx], toolCompleted: true};
                for (let i = savedIdx - 1; i >= 0; i--) {
                  if (msgs[i].avatarPulse === "thinking") {
                    msgs[i] = { ...msgs[i], avatarPulse: "greet" };
                    break;
                  }
                }
              }
              msgs.push({ id: crypto.randomUUID(), role: 'assistant', content: event.data });
              return msgs;
            });
            buffer = event.data;
            isInToolUse = false;
            toolIdx = -1;
          } else {
            buffer += event.data;
            setMessages(prev => {
              const msgs = [...prev];
              msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], content: buffer, isToolUsing: false };
              return msgs;
            });
          }
        }
      }
    }
    setLoading(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as unknown as FormEvent);
    }
  };

  // ...（UI部分は変更なし）
  return (
    <div className="container">
      {/* 以降同じ */}
    </div>
  );
}

export default App;
