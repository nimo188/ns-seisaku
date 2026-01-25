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

// メインのアプリケーションコンポーネント
function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // メッセージ追加時に自動スクロール
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // フォーム送信処理
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    // ユーザーメッセージを作成
    const userMessage: Message = { id: crypto.randomUUID(), role: 'user', content: input.trim() };

    // メッセージ配列に追加（ユーザー発言 + 空のAI応答）
    setMessages(prev => [...prev, userMessage, { id: crypto.randomUUID(), role: 'assistant', content: '', avatarPulse: 'thinking' }]);
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
      body: JSON.stringify({ prompt: userMessage.content }),
    });

    // SSEストリーミングを処理
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let isInToolUse = false;
    let toolIdx = -1;

    // ストリームを読み続ける
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      // 受信データを行ごとに処理
      for (const line of decoder.decode(value, { stream: true }).split('\n')) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6);
        if (data === '[DONE]') continue;
        const event = JSON.parse(data);

        // ツール使用開始イベント
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

        // テキストイベント（AI応答本文）
        if (event.type === 'text' && event.data) {
          if (isInToolUse && !buffer) {
            // ツール実行後の最初のテキスト → ツールを完了状態に
            const savedIdx = toolIdx;
            setMessages(prev => {
              const msgs = [...prev];
              if (savedIdx >= 0 && savedIdx < msgs.length){
                msgs[savedIdx] = { ...msgs[savedIdx], toolCompleted: true};
                // キズナビ君思考停止 & かわいく挨拶
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
            // 通常のテキスト蓄積（ストリーミング表示）
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

  // Textareaのキーダウンハンドラ
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
  if (e.key === "Enter" && e.shiftKey) {
    e.preventDefault(); // 改行させない
    handleSubmit(e as unknown as FormEvent); // 既存のhandleSubmitを使う場合
  }
};

  // チャットUI
  return (
    <div className="container">
      <header className="header">
        <div className="badge"></div>
        <div className="brand">キズナビ君 ／ 新しいチャット</div>
        <p className="subtitle">社内ナレッジを検索します</p>
      </header>

      <div className="message-area">
        <div className="message-container">
          {messages.map((msg, index) => (
            <div>
              <div key={msg.id} className={`message-row ${msg.role}`}>
                {/* キズナビ君の描画 */}
                <div className={`avatar ${msg.avatarPulse ? `is-${msg.avatarPulse}` : ""}`}>
                {msg.role === "assistant" && (index === 0 || messages[index-1].role !== "assistant")?
                    <div className='kz'>
                      <img className='part head' src={kizunavi_head}></img>
                      <img className='part body' src={kizunavi_body}></img>
                      <img className='part arm-r' src={kizunavi_right}></img>
                      <img className='part arm-l' src={kizunavi_left}></img>
                    </div>
                :null}
                </div>

                {/* メッセージバブルの描画 */}
                <div className={`bubble ${msg.role}`}>
                  {msg.role === 'assistant' && !msg.content && !msg.isToolUsing && (
                    <span className="thinking">考え中…</span>
                  )}
                  {msg.isToolUsing && (
                    <span className={`tool-status ${msg.toolCompleted ? 'completed' : 'active'}`}>
                      {msg.toolCompleted ? '✓' : '⏳'} {msg.toolName}
                      {msg.toolCompleted ? 'プロジェクト履歴を参照しました。' : 'を利用中...'}
                    </span>
                  )}
                  {msg.content && !msg.isToolUsing && (
                    <ReactMarkdown
                      components={{
                        a: ({ node, ...props }) => (
                          <a {...props} target="_blank" rel="noopener noreferrer" />
                        ),
                      }}
                    >
                      {msg.content}
                    </ReactMarkdown>
                  )}
                </div>
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      </div>

      <div className="form-wrapper">
        <form onSubmit={handleSubmit} className="form">
          <textarea  value={input} onChange={e => setInput(e.target.value)} placeholder="メッセージを入力...(Shift + Enter で送信)" disabled={loading} className="input" onKeyDown={handleKeyDown}/>
          <button type="submit" disabled={loading || !input.trim()} className="button">
            {loading ? '⌛️' : '送信'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default App;