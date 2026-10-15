import { describe, expect, it } from "vitest";
import { srtToVtt } from "./srt";

describe("srtToVtt", () => {
  it("converts a basic file with BOM, CRLF and indices", () => {
    const srt = "﻿1\r\n00:00:01,000 --> 00:00:02,500\r\nHello\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nWorld\r\nline two\r\n";
    expect(srtToVtt(srt)).toBe(
      "WEBVTT\n\n00:00:01.000 --> 00:00:02.500\nHello\n\n00:00:03.000 --> 00:00:04.000\nWorld\nline two\n",
    );
  });

  it("drops override tags and font tags but keeps i/b/u", () => {
    const out = srtToVtt('1\n00:00:01,000 --> 00:00:02,000\n{\\an8}<i>Hi</i> {\\i1}<b>x</b> <font color="red">y</font> <u>z</u>\n');
    expect(out).toContain("<i>Hi</i> <b>x</b> y <u>z</u>");
    expect(out).not.toContain("{");
    expect(out).not.toContain("font");
  });

  it("tolerates missing indices, extra blank lines and no trailing newline", () => {
    const out = srtToVtt("00:00:01,000 --> 00:00:02,000\nA\n\n\n\n00:00:03,000 --> 00:00:04,000\nB");
    expect(out).toBe("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nA\n\n00:00:03.000 --> 00:00:04.000\nB\n");
  });

  it("does not drop a numeric text line", () => {
    const out = srtToVtt("1\n00:00:01,000 --> 00:00:02,000\n42\n\n2\n00:00:03,000 --> 00:00:04,000\nx\n");
    expect(out).toContain("\n42\n");
    expect(out).not.toContain("\n2\n");
  });

  it("drops cue settings after the timing and escapes bare ampersands", () => {
    const out = srtToVtt("1\n00:00:01,000 --> 00:00:02,000 X1:100\nTom & Jerry\n");
    expect(out).toContain("00:00:01.000 --> 00:00:02.000\nTom &amp; Jerry");
  });
});
