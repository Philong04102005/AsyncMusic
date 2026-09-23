import Link from "next/link";
import { Header } from "@/components/header";
export default function About() {
  return (
    <>
      <Header />
      <main className="prose-page">
        <Link href="/">← Back to discovery</Link>
        <h1>A shared room. Your own player.</h1>
        <p>
          Resonance coordinates rooms, chat and playback timestamps. Music and
          video play directly in each listener&apos;s browser through the
          official YouTube and SoundCloud embedded players. We never download,
          extract or relay audio.
        </p>
        <h2>Listening together</h2>
        <p>
          Timing is best-effort. Ads, buffering, device restrictions and
          regional availability can differ between listeners. Premium
          subscriptions belong to each person&apos;s provider session. If
          playback is blocked, tap the player or use Resync. We do not remove
          ads or bypass provider limits.
        </p>
        <h2>Your data</h2>
        <p>
          Guest sessions expire after seven days. Google sign-in stores your
          Google identifier, display name and profile image in our database;
          provider access tokens from that sign-in are discarded. Room members
          can see your display name and chat. Room state, queue and chat are
          deleted after everyone leaves and the grace period ends.
        </p>
        <p>
          Sessions use essential HttpOnly cookies. Embedded players connect to
          their providers when you choose to start a listening session, and
          those providers may set cookies and process usage data under their own
          policies.
        </p>
        <h2>Provider policies</h2>
        <p>
          By using YouTube playback, you agree to the{" "}
          <a href="https://www.youtube.com/t/terms">YouTube Terms of Service</a>
          . Read the{" "}
          <a href="https://policies.google.com/privacy">
            Google Privacy Policy
          </a>
          , <a href="https://soundcloud.com/terms-of-use">SoundCloud Terms</a>{" "}
          and{" "}
          <a href="https://soundcloud.com/pages/privacy">
            SoundCloud Privacy Policy
          </a>
          .
        </p>
        <h2>Self-hosted deployments</h2>
        <p>
          The operator of each deployment is responsible for publishing contact
          information, retention policies and an account deletion process
          appropriate to their service before making it public. See the
          deployment guide in the source repository.
        </p>
      </main>
    </>
  );
}
