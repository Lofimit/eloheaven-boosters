import { Link } from "react-router";
import { useTitle } from "../lib/hooks";

export default function NotFound() {
  useTitle("Not found");
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center animate-fade-up">
      <p className="font-display text-8xl font-bold text-gradient">404</p>
      <h1 className="mt-2 text-2xl font-bold">Lost between worlds</h1>
      <p className="mt-2 text-muted">This page doesn't exist, or it drifted away.</p>
      <Link to="/dashboard" className="btn btn-primary mt-6">Back to dashboard</Link>
    </div>
  );
}
