"use client";
import Link from "next/link";
import { AudioLines, ArrowUpRight, LogOut } from "lucide-react";
import { useSession } from "./session";
export function Header() {
  const { user, signIn, logout } = useSession();
  return (
    <header className="site-header">
      <Link href="/" className="brand">
        <span className="brand-icon">
          <AudioLines size={25} strokeWidth={2.4} />
        </span>
        resonance<span className="brand-dot">.</span>
      </Link>
      <nav aria-label="Main navigation">
        <Link className="nav-link" href="/">
          Discover
        </Link>
        <a className="nav-link" href="/#how-it-works">
          How it works <ArrowUpRight size={13} />
        </a>
      </nav>
      <div className="header-user">
        {user ? (
          <>
            <span className="avatar small">
              {user.displayName.slice(0, 1).toUpperCase()}
            </span>
            <span>{user.displayName}</span>
            <button
              className="icon-button"
              title="Sign out"
              aria-label="Sign out"
              onClick={() => void logout()}
            >
              <LogOut size={17} />
            </button>
          </>
        ) : (
          <button className="button secondary small-button" onClick={signIn}>
            Come on in <ArrowUpRight size={16} />
          </button>
        )}
      </div>
    </header>
  );
}
