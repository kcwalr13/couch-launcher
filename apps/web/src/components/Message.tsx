import { useEffect } from "react";

export interface Message {
  id: number;
  text: string;
  kind: "info" | "error";
}

/** On-screen message for errors and confirmations. Disappears after a few seconds. */
export function MessageToast({ message, onDone }: { message: Message | null; onDone: () => void }) {
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(onDone, message.kind === "error" ? 8000 : 4000);
    return () => clearTimeout(t);
  }, [message, onDone]);
  if (!message) return null;
  return (
    <div
      className="absolute inset-x-0 bottom-[9vh] z-50 flex justify-center"
      role="alert"
      data-testid="message"
      data-kind={message.kind}
    >
      <div
        className={`max-w-[80rem] rounded-2xl border-[0.25rem] bg-slate-2 px-10 py-5 ${message.kind === "error" ? "border-danger" : "border-lamp"}`}
      >
        {message.kind === "error" && <span className="mr-4 font-bold text-danger">Problem:</span>}
        {message.text}
      </div>
    </div>
  );
}
