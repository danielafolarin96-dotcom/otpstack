import Link from "next/link";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-bold text-ink">Log in</h1>
        <p className="text-sm text-text-dim">Welcome back to OtpStack.</p>
      </div>
      <LoginForm />
      <p className="text-center text-sm text-text-dim">
        Don&apos;t have an account?{" "}
        <Link href="/signup" className="font-medium text-signal hover:text-signal-bright">
          Create one
        </Link>
      </p>
    </div>
  );
}
