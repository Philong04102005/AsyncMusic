"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { User } from "@resonance/shared";
import { api, post } from "@/lib/api";
import { Dialog } from "./ui/dialog";
import { Headphones, ArrowRight } from "lucide-react";
interface SessionContext {
  user: User | null;
  loading: boolean;
  signIn: () => void;
  logout: () => Promise<void>;
}
const Context = createContext<SessionContext>({
  user: null,
  loading: true,
  signIn: () => {},
  logout: async () => {},
});
export const useSession = () => useContext(Context);
export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null),
    [loading, setLoading] = useState(true),
    [open, setOpen] = useState(false);
  const [google, setGoogle] = useState(false),
    [name, setName] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    api<{ user: User | null; googleEnabled: boolean }>("/api/session")
      .then((data) => {
        setUser(data.user);
        setGoogle(data.googleEnabled);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  return (
    <Context.Provider
      value={{
        user,
        loading,
        signIn: () => setOpen(true),
        logout: async () => {
          await post("/api/auth/logout", {});
          setUser(null);
          window.location.assign("/");
        },
      }}
    >
      {children}
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Make yourself at home."
        description="Pick a name and find your people. No account needed."
      >
        <div className="auth-symbol">
          <Headphones size={34} />
        </div>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError("");
            try {
              const data = await post<{ user: User }>("/api/auth/guest", {
                displayName: name,
              });
              setUser(data.user);
              setOpen(false);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Your display name
            <input
              autoFocus
              required
              minLength={2}
              maxLength={40}
              placeholder="What should we call you?"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="button primary full" disabled={busy}>
            {busy ? "Joining…" : "Continue as guest"}
            <ArrowRight size={17} />
          </button>
        </form>
        {google && (
          <>
            <div className="divider-label">or</div>
            <a className="button secondary full" href="/api/auth/google">
              Continue with Google
            </a>
          </>
        )}
        <p className="fine-print">
          Your sign-in is separate from your music provider account.
        </p>
      </Dialog>
    </Context.Provider>
  );
}
