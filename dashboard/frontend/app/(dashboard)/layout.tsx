import Sidebar from "@/components/layout/sidebar";
import ChatPanel from "@/components/chat/chat-panel";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-background">
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-350 mx-auto px-6 py-6">
            {children}
          </div>
        </main>
      </div>
      <ChatPanel />
    </div>
  );
}
