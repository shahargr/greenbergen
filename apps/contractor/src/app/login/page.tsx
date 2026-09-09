import Link from "next/link";
import { SignIn } from "@shared/SignIn";

export const metadata = { title: "Sign in" };

export default function LoginPage() {
  return <SignIn home="/work" footer={<>New here? <Link href="/join">Join as a contractor</Link></>} />;
}
