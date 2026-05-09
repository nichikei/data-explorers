import Sidebar from "@/components/layout/sidebar";
import ChatPanel from "@/components/chat/chat-panel";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <main className="flex-1 overflow-y-auto p-6 bg-background">
          {children}
        </main>
      </div>
      <ChatPanel />
    </div>
  );
}
