"use client";

import type { ComponentProps, FocusEvent, KeyboardEvent, MouseEvent, ReactNode } from "react";
import Link from "next/link";

import { getTeamPath } from "@/lib/team-directory";

type TeamLinkProps = Omit<ComponentProps<typeof Link>, "href"> & {
  team: string;
  children?: ReactNode;
  stopPropagation?: boolean;
};

export function TeamLink({
  team,
  children,
  stopPropagation = false,
  onBlur,
  onClick,
  onFocus,
  onKeyDown,
  onMouseEnter,
  onMouseLeave,
  style,
  ...linkProps
}: TeamLinkProps) {
  const applyUnderlineState = (element: HTMLAnchorElement, isActive: boolean) => {
    element.style.textDecorationLine = isActive ? "underline" : `${style?.textDecorationLine ?? ""}`;
    element.style.textDecorationThickness = isActive ? "2px" : `${style?.textDecorationThickness ?? ""}`;
    element.style.textUnderlineOffset = isActive ? "4px" : `${style?.textUnderlineOffset ?? ""}`;
  };

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (stopPropagation) {
      event.stopPropagation();
    }

    onClick?.(event);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLAnchorElement>) => {
    if (stopPropagation) {
      event.stopPropagation();
    }

    onKeyDown?.(event);
  };

  const handleMouseEnter = (event: MouseEvent<HTMLAnchorElement>) => {
    applyUnderlineState(event.currentTarget, true);
    onMouseEnter?.(event);
  };

  const handleMouseLeave = (event: MouseEvent<HTMLAnchorElement>) => {
    applyUnderlineState(event.currentTarget, false);
    onMouseLeave?.(event);
  };

  const handleFocus = (event: FocusEvent<HTMLAnchorElement>) => {
    applyUnderlineState(event.currentTarget, true);
    onFocus?.(event);
  };

  const handleBlur = (event: FocusEvent<HTMLAnchorElement>) => {
    applyUnderlineState(event.currentTarget, false);
    onBlur?.(event);
  };

  return (
    <Link
      {...linkProps}
      href={getTeamPath(team)}
      onBlur={handleBlur}
      onClick={handleClick}
      onFocus={handleFocus}
      onKeyDown={handleKeyDown}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={style}
    >
      {children ?? team}
    </Link>
  );
}