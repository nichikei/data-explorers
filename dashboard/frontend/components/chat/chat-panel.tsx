"use client";

import { useState, useRef, useEffect } from "react";
import { MessageCircle, X, Send, Loader2, Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface Message { role: "user" | "assistant"; content: string; }

const EXAMPLES = [
  "Top 5 đại lý doanh số T3/2026?",
  "Nhóm xe nào tăng trưởng mạnh nhất Q1?",
  "Danh sách đại lý nguy cơ churn?",
  "Doanh thu theo vùng miền?",
];

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export default function ChatPanel() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send(text: string) {
    if (!text.trim() || loading) return;
    setInput("");
    const userMsg: Message = { role: "user", content: text };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    const history = messages.slice(-8).map(m => ({ role: m.role, content: m.content }));
    const assistantMsg: Message = { role: "assistant", content: "" };
    setMessages(prev => [...prev, assistantMsg]);

    try {
      const res = await fetch(`${BASE}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history }),
      });
      if (!res.body) throw new Error("No stream");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") break;
          try {
            const { text: chunk } = JSON.parse(payload);
            setMessages(prev => {
              const updated = [...prev];
              updated[updated.length - 1] = {
                ...updated[updated.length - 1],
                content: updated[updated.length - 1].content + chunk,
              };
              return updated;
            });
          } catch { /* ignore malformed */ }
        }
      }
    } catch (e) {
      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          ...updated[updated.length - 1],
          content: "Lỗi kết nối API. Kiểm tra ANTHROPIC_API_KEY trong .env.",
        };
        return updated;
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {/* Toggle button */}
      <button
        onClick={() => setOpen(o => !o)}
        className={cn(
          "fixed bottom-5 right-5 z-50 flex h-12 w-12 items-center justify-center rounded-full shadow-lg transition-all",
          "bg-primary text-primary-foreground hover:bg-primary/90",
        )}
      >
        {open ? <X className="h-5 w-5" /> : <MessageCircle className="h-5 w-5" />}
      </button>

      {/* Panel */}
      {open && (
        <div className="fixed bottom-20 right-5 z-50 flex flex-col w-80 h-[520px] rounded-xl border border-border bg-card shadow-2xl">
          {/* Header */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
            <Bot className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold">Hỏi dữ liệu</span>
            <span className="ml-auto text-[10px] text-muted-foreground">Claude Haiku</span>
          </div>

          {/* Messages */}
          <ScrollArea className="flex-1 px-3 py-2">
            {messages.length === 0 && (
              <div className="py-4 space-y-2">
                <p className="text-xs text-muted-foreground text-center mb-3">Ví dụ câu hỏi:</p>
                {EXAMPLES.map(ex => (
                  <button
                    key={ex}
                    onClick={() => send(ex)}
                    className="w-full text-left text-xs px-3 py-2 rounded-lg bg-accent/50 hover:bg-accent text-muted-foreground hover:text-accent-foreground transition-colors"
                  >
                    {ex}
                  </button>
                ))}
              </div>
            )}
            {messages.map((msg, i) => (
              <div key={i} className={cn("mb-3 flex", msg.role === "user" ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[85%] rounded-xl px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap",
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-accent text-accent-foreground",
                  )}
                >
                  {msg.content || (loading && i === messages.length - 1
                    ? <Loader2 className="h-3 w-3 animate-spin" />
                    : "")}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </ScrollArea>

          {/* Input */}
          <div className="flex gap-2 px-3 py-3 border-t border-border">
            <Input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !e.shiftKey && send(input)}
              placeholder="Nhập câu hỏi..."
              className="text-xs h-8"
              disabled={loading}
            />
            <Button size="sm" className="h-8 w-8 p-0 shrink-0" onClick={() => send(input)} disabled={loading || !input.trim()}>
              {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
