export interface ToastItem {
  id: number;
  text: string;
  kind: 'error' | 'info';
}

interface Props {
  toasts: ToastItem[];
}

export default function Toasts({ toasts }: Props) {
  return (
    <div className="toast-stack">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.kind}`}>
          {toast.text}
        </div>
      ))}
    </div>
  );
}
