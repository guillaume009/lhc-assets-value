"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

type PlayerHeadshotProps = {
  name: string;
  alt?: string;
  className: string;
  fallbackClassName?: string;
  imageClassName?: string;
};

const resolvedHeadshots = new Map<string, string | null>();
const pendingHeadshots = new Map<string, Promise<string | null>>();

const getInitials = (name: string) =>
  name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

const loadHeadshot = async (name: string) => {
  const cacheKey = name.trim().toLowerCase();

  if (!cacheKey) {
    return null;
  }

  const cached = resolvedHeadshots.get(cacheKey);

  if (cached !== undefined) {
    return cached;
  }

  const pending = pendingHeadshots.get(cacheKey);

  if (pending) {
    return pending;
  }

  const request = fetch(`/api/nhl/headshot?name=${encodeURIComponent(name)}`)
    .then(async (response) => {
      if (!response.ok) {
        return null;
      }

      const payload = (await response.json()) as { headshotUrl?: string | null };
      const headshotUrl = payload.headshotUrl ?? null;
      resolvedHeadshots.set(cacheKey, headshotUrl);
      return headshotUrl;
    })
    .catch(() => {
      resolvedHeadshots.set(cacheKey, null);
      return null;
    })
    .finally(() => {
      pendingHeadshots.delete(cacheKey);
    });

  pendingHeadshots.set(cacheKey, request);
  return request;
};

export function PlayerHeadshot({
  name,
  alt,
  className,
  fallbackClassName,
  imageClassName,
}: PlayerHeadshotProps) {
  const cacheKey = name.trim().toLowerCase();

  return (
    <PlayerHeadshotInner
      key={cacheKey}
      alt={alt}
      cacheKey={cacheKey}
      className={className}
      fallbackClassName={fallbackClassName}
      imageClassName={imageClassName}
      name={name}
    />
  );
}

type PlayerHeadshotInnerProps = PlayerHeadshotProps & {
  cacheKey: string;
};

function PlayerHeadshotInner({
  name,
  alt,
  cacheKey,
  className,
  fallbackClassName,
  imageClassName,
}: PlayerHeadshotInnerProps) {
  const containerRef = useRef<HTMLSpanElement | null>(null);
  const [headshotUrl, setHeadshotUrl] = useState<string | null>(() => resolvedHeadshots.get(cacheKey) ?? null);
  const [shouldResolve, setShouldResolve] = useState(() => resolvedHeadshots.has(cacheKey));

  useEffect(() => {
    if (shouldResolve) {
      return;
    }

    const element = containerRef.current;

    if (!element || typeof IntersectionObserver === "undefined") {
      setShouldResolve(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) {
          return;
        }

        setShouldResolve(true);
        observer.disconnect();
      },
      { rootMargin: "240px 0px" },
    );

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [shouldResolve]);

  useEffect(() => {
    if (!shouldResolve) {
      return;
    }

    let cancelled = false;

    loadHeadshot(name).then((nextHeadshotUrl) => {
      if (!cancelled) {
        setHeadshotUrl(nextHeadshotUrl);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [name, shouldResolve]);

  if (headshotUrl) {
    return (
      <span ref={containerRef} className="shrink-0">
        <Image
          alt={alt ?? `${name} headshot`}
          className={imageClassName ?? className}
          height={256}
          sizes="(max-width: 768px) 96px, 160px"
          src={headshotUrl}
          unoptimized
          width={256}
        />
      </span>
    );
  }

  return (
    <span ref={containerRef} className="shrink-0">
      <div className={fallbackClassName ?? className} aria-label={alt ?? `${name} initials`}>
        {getInitials(name)}
      </div>
    </span>
  );
}
