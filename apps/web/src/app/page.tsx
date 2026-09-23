"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  AudioLines,
  Headphones,
  Plus,
  Search,
  Radio,
  Users,
  Disc3,
  RefreshCw,
  SquarePlay as Youtube,
  Cloud,
} from "lucide-react";
import type { PublicRoom, ProviderId } from "@resonance/shared";
import { api } from "@/lib/api";
import { Header } from "@/components/header";
import { CreateRoom } from "@/components/create-room";
import { useSession } from "@/components/session";

export default function Home() {
  const { user, signIn } = useSession();
  const [open, setOpen] = useState(false),
    [rooms, setRooms] = useState<PublicRoom[]>([]),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState<"all" | ProviderId>("all"),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  async function refresh() {
    setError("");
    try {
      setRooms((await api<{ rooms: PublicRoom[] }>("/api/rooms")).rooms);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 20000);
    return () => clearInterval(timer);
  }, []);
  const visible = rooms.filter(
    (room) =>
      (filter === "all" || room.provider === filter) &&
      `${room.name} ${room.currentTrack?.title ?? ""}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const create = () => (user ? setOpen(true) : signIn());
  return (
    <>
      <Header />
      <main className="home-main">
        <section className="hero">
          <div className="hero-copy">
            <span className="eyebrow">
              <span className="live-dot" /> A LITTLE CLOSER, ONE SONG AT A TIME
            </span>
            <h1>
              Good music.
              <br />
              <span>Better together.</span>
            </h1>
            <p>
              Your favorite tracks. Your favorite people.
              <br />
              One shared moment, wherever you are.
            </p>
            <div className="hero-actions">
              <button className="button primary" onClick={create}>
                <Plus size={19} />
                Start a room
                <ArrowUpRight size={17} />
              </button>
              <a href="#discover" className="text-button">
                Find your frequency <ArrowRight size={17} />
              </a>
            </div>
            <div className="hero-note">
              <Headphones size={15} />
              Free to join. Made to be shared.
            </div>
          </div>
          <div
            className="hero-art"
            role="img"
            aria-label="A vinyl record surrounded by colorful sound waves"
          >
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <div className="orbit orbit-three" />
            <div className="art-spark spark-one">✦</div>
            <div className="art-spark spark-two">✦</div>
            <div className="floating-label top-label">
              <span className="live-dot" /> ON THE SAME WAVELENGTH
            </div>
            <div className="vinyl">
              <div className="vinyl-label">
                <AudioLines size={44} />
                <span>SIDE A · TOGETHER</span>
                <i />
              </div>
            </div>
            <div className="floating-label bottom-label">
              <div className="wave-bars">
                {Array.from({ length: 12 }, (_, i) => (
                  <i key={i} style={{ height: `${12 + ((i * 13) % 25)}px` }} />
                ))}
              </div>
              <span>
                Different places.
                <br />
                <strong>Same feeling.</strong>
              </span>
            </div>
            <span className="art-caption">SOUND GOOD. FEEL CONNECTED.</span>
          </div>
        </section>
        <div className="source-strip">
          <span>YOUR MUSIC, IN GOOD COMPANY</span>
          <div>
            <Youtube size={21} />
            YouTube
          </div>
          <span className="strip-plus">+</span>
          <div>
            <Cloud size={23} />
            SoundCloud
          </div>
          <span className="strip-end">
            Played straight from the source <ArrowUpRight size={13} />
          </span>
        </div>
        <section id="discover" className="discover">
          <div className="section-heading">
            <div>
              <div className="eyebrow subdued">
                THERE&apos;S A ROOM FOR YOUR MOOD
              </div>
              <h2>
                Find your people<span className="accent">.</span>
              </h2>
              <p>Drop in, tune out the noise, and listen together.</p>
            </div>
            <button className="button secondary" onClick={create}>
              <Plus size={17} />
              Create a room
            </button>
          </div>
          <div className="discovery-toolbar">
            <div className="filter-tabs" aria-label="Filter by provider">
              {(["all", "youtube", "soundcloud"] as const).map((value) => (
                <button
                  key={value}
                  aria-pressed={filter === value}
                  className={filter === value ? "active" : ""}
                  onClick={() => setFilter(value)}
                >
                  {value === "all" ? (
                    <Radio size={16} />
                  ) : value === "youtube" ? (
                    <Youtube size={16} />
                  ) : (
                    <Cloud size={16} />
                  )}
                  {value === "all"
                    ? "All rooms"
                    : value === "youtube"
                      ? "YouTube"
                      : "SoundCloud"}
                </button>
              ))}
            </div>
            <div className="search-input">
              <Search size={17} />
              <input
                aria-label="Search rooms"
                placeholder="Find a room or a song…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
          </div>
          <div className="list-caption">
            <span>
              <span className="live-dot" /> {visible.length} live{" "}
              {visible.length === 1 ? "room" : "rooms"}
            </span>
            <button
              onClick={() => void refresh()}
              className="text-button subtle"
            >
              <RefreshCw size={13} /> Refresh
            </button>
          </div>
          {error ? (
            <div className="empty-state">
              <Radio size={30} />
              <h3>We couldn&apos;t tune in.</h3>
              <p>{error}</p>
              <button
                className="button secondary"
                onClick={() => void refresh()}
              >
                Try again
              </button>
            </div>
          ) : loading ? (
            <div className="room-grid">
              {[0, 1, 2].map((i) => (
                <div className="room-skeleton" key={i} />
              ))}
            </div>
          ) : visible.length ? (
            <div className="room-grid">
              {visible.map((room, i) => (
                <Link
                  href={`/room/${room.slug}`}
                  key={room.id}
                  className={`room-card palette-${i % 4}`}
                >
                  <div className="room-card-art">
                    {room.currentTrack?.thumbnail ? (
                      <img src={room.currentTrack.thumbnail} alt="" />
                    ) : (
                      <div className="mini-record">
                        <Disc3 size={80} strokeWidth={1} />
                      </div>
                    )}
                    <span className="provider-badge">
                      {room.provider === "youtube" ? (
                        <Youtube size={14} />
                      ) : (
                        <Cloud size={14} />
                      )}
                      {room.provider === "youtube" ? "YouTube" : "SoundCloud"}
                    </span>
                    <span className="member-badge">
                      <Headphones size={13} />
                      {room.memberCount}
                    </span>
                    <span className="card-enter">
                      <ArrowUpRight size={22} />
                    </span>
                  </div>
                  <div className="room-card-body">
                    <h3>{room.name}</h3>
                    <p>
                      <AudioLines size={14} />
                      {room.currentTrack?.title ??
                        "The next great song starts here"}
                    </p>
                    <div className="room-card-footer">
                      <span className="avatar tiny">{room.ownerName[0]}</span>
                      <span>Hosted by {room.ownerName}</span>
                      <span className="live-text">LIVE</span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <div className="empty-record">
                <Disc3 size={44} />
              </div>
              <h3>
                {query
                  ? "No rooms on this frequency."
                  : "Be the first to set the mood."}
              </h3>
              <p>
                {query
                  ? "Try another search, or start a room of your own."
                  : "It’s quiet in here. A good song and a few friends can change that."}
              </p>
              <button className="button primary" onClick={create}>
                <Plus size={17} />
                Start a room
              </button>
            </div>
          )}
        </section>
        <section className="how-section" id="how-it-works">
          <div>
            <span className="eyebrow subdued">
              LESS SCROLLING. MORE LISTENING.
            </span>
            <h2>
              A little ritual.
              <br />A lot of connection.
            </h2>
          </div>
          <div className="how-step">
            <span>01</span>
            <Radio size={22} />
            <h3>Make a space</h3>
            <p>Open a room for everyone, or keep it just between friends.</p>
          </div>
          <div className="how-step">
            <span>02</span>
            <Disc3 size={22} />
            <h3>Set the soundtrack</h3>
            <p>Queue your favorites from YouTube or SoundCloud.</p>
          </div>
          <div className="how-step">
            <span>03</span>
            <Users size={22} />
            <h3>Be here, together</h3>
            <p>Share a link. Press play. Let the conversation flow.</p>
          </div>
        </section>
        <footer>
          <Link href="/" className="brand">
            <AudioLines size={20} />
            resonance.
          </Link>
          <span>Music brings us a little closer.</span>
          <Link href="/about">
            Privacy & provider notes <ArrowUpRight size={13} />
          </Link>
        </footer>
      </main>
      <CreateRoom open={open} setOpen={setOpen} />
    </>
  );
}
