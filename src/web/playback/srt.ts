/** Converts SRT subtitle text to WebVTT. Pure, so it can be unit-tested. */
const TIME = String.raw`(?:\d{1,2}:)?\d{1,2}:\d{2}[,.]\d{1,3}`;
const TIMING = new RegExp(String.raw`^\s*(${TIME})\s*-->\s*(${TIME})`);

function fixTime(t: string): string {
  const [clock, ms = "0"] = t.split(/[,.]/);
  const parts = clock.split(":");
  while (parts.length < 3) parts.unshift("0");
  return `${parts.map((p) => p.padStart(2, "0")).join(":")}.${ms.padEnd(3, "0")}`;
}

function cleanLine(line: string): string {
  return line
    .replace(/\{\\[^}]*\}/g, "")
    .replace(/<\/?font[^>]*>/gi, "")
    .replace(/&(?!(?:amp|lt|gt|nbsp|lrm|rlm);)/g, "&amp;")
    .trimEnd();
}

export function srtToVtt(srt: string): string {
  const text = srt.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const cues: string[] = [];
  let current: string[] | null = null;
  const flush = () => {
    if (current && current.length > 1) cues.push(current.join("\n"));
    current = null;
  };

  // Anything before a timing line (cue indices, junk) is ignored, and a blank
  // line ends the cue, so a numeric text line is never mistaken for an index.
  for (const line of text.split("\n")) {
    const m = TIMING.exec(line);
    if (m) {
      flush();
      current = [`${fixTime(m[1])} --> ${fixTime(m[2])}`];
    } else if (current) {
      if (line.trim() === "") flush();
      else current.push(cleanLine(line));
    }
  }
  flush();
  return `WEBVTT\n\n${cues.join("\n\n")}\n`;
}
