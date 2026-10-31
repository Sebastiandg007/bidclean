import { Injectable, Logger } from '@nestjs/common';

/**
 * Bytes-based video duration probe.
 *
 * Reads the real playback duration from a downloaded video buffer by parsing its container
 * metadata — the SERVER-AUTHORITATIVE duration used to bound an arrival clip (the client-declared
 * value is advisory only). It deliberately avoids a heavyweight media dependency by parsing the
 * self-describing headers of the two container families the mobile client can produce: ISO-BMFF
 * (MP4 / QuickTime `.mov`, via the `moov`→`mvhd` box) and Matroska/WebM (via the `Duration` element
 * scaled by `TimecodeScale`). It returns `null` for any buffer it cannot confidently probe as valid
 * video — the caller treats a `null` duration as an invalid/unsupported object (400), never as
 * "unbounded". It is a NestJS provider so it can be swapped/mocked in tests. Never logs video bytes.
 */
@Injectable()
export class VideoDurationProbe {
  private readonly logger = new Logger(VideoDurationProbe.name);

  private static readonly MS_PER_SECOND = 1000;
  /** Bound the scan so a hostile/huge buffer never drives an unbounded parse. */
  private static readonly MAX_SCAN_BYTES = 8 * 1024 * 1024;

  /**
   * Probe the real duration of a video buffer in milliseconds.
   *
   * @param buffer Raw video bytes downloaded from storage.
   * @param contentType Server-observed content type (used to pick a parser).
   * @returns Duration in milliseconds, or `null` when the buffer is not confidently probeable.
   */
  probe(buffer: Buffer, contentType: string): number | null {
    try {
      const scan = buffer.length > VideoDurationProbe.MAX_SCAN_BYTES
        ? buffer.subarray(0, VideoDurationProbe.MAX_SCAN_BYTES)
        : buffer;
      if (this.looksLikeIsoBmff(scan)) {
        return this.probeIsoBmff(scan);
      }
      if (this.looksLikeMatroska(scan, contentType)) {
        return this.probeMatroska(scan);
      }
      return null;
    } catch {
      this.logger.warn('Video duration probe failed for an object (treated as unprobeable)');
      return null;
    }
  }

  /** True when the buffer contains an ISO-BMFF `ftyp` box near the start. */
  private looksLikeIsoBmff(buffer: Buffer): boolean {
    if (buffer.length < 12) {
      return false;
    }
    return buffer.toString('ascii', 4, 8) === 'ftyp';
  }

  /**
   * Walk top-level ISO-BMFF boxes to `moov`, then its child `mvhd`, and read the timescale +
   * duration. `mvhd` version 0 uses 32-bit fields at fixed offsets; version 1 uses 64-bit.
   */
  private probeIsoBmff(buffer: Buffer): number | null {
    const moov = this.findBox(buffer, 'moov', 0, buffer.length);
    if (!moov) {
      return null;
    }
    const mvhd = this.findBox(buffer, 'mvhd', moov.contentStart, moov.end);
    if (!mvhd) {
      return null;
    }
    return this.readMvhdDuration(buffer, mvhd.contentStart);
  }

  /** Read timescale + duration from an `mvhd` box body and convert to milliseconds. */
  private readMvhdDuration(buffer: Buffer, contentStart: number): number | null {
    const version = buffer[contentStart] ?? 0;
    if (version === 1) {
      if (contentStart + 28 > buffer.length) {
        return null;
      }
      const timescale = buffer.readUInt32BE(contentStart + 20);
      const duration = Number(buffer.readBigUInt64BE(contentStart + 24));
      return this.scaleToMs(duration, timescale);
    }
    if (contentStart + 20 > buffer.length) {
      return null;
    }
    const timescale = buffer.readUInt32BE(contentStart + 12);
    const duration = buffer.readUInt32BE(contentStart + 16);
    return this.scaleToMs(duration, timescale);
  }

  /** Convert a duration in `timescale` units to milliseconds; null when the scale is unusable. */
  private scaleToMs(duration: number, timescale: number): number | null {
    if (timescale <= 0 || duration <= 0) {
      return null;
    }
    return Math.round((duration / timescale) * VideoDurationProbe.MS_PER_SECOND);
  }

  /**
   * Find a top-level ISO-BMFF box by its 4-char type within `[from, to)`. Returns the box's body
   * bounds, or null. Handles the 64-bit large-size form (`size === 1`).
   */
  private findBox(
    buffer: Buffer,
    type: string,
    from: number,
    to: number,
  ): { contentStart: number; end: number } | null {
    let offset = from;
    while (offset + 8 <= to) {
      let size = buffer.readUInt32BE(offset);
      const boxType = buffer.toString('ascii', offset + 4, offset + 8);
      let headerBytes = 8;
      if (size === 1) {
        if (offset + 16 > to) {
          return null;
        }
        size = Number(buffer.readBigUInt64BE(offset + 8));
        headerBytes = 16;
      }
      if (size < headerBytes) {
        return null;
      }
      const end = offset + size;
      if (boxType === type) {
        return { contentStart: offset + headerBytes, end: Math.min(end, to) };
      }
      offset = end;
    }
    return null;
  }

  /** True for Matroska/WebM: the EBML magic `0x1A45DFA3` at the start. */
  private looksLikeMatroska(buffer: Buffer, contentType: string): boolean {
    if (buffer.length < 4) {
      return false;
    }
    const isEbml =
      buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3;
    return isEbml || contentType === 'video/webm';
  }

  /**
   * Scan a Matroska/WebM buffer for the `TimecodeScale` (0x2AD7B1, default 1_000_000 ns) and the
   * `Duration` float (0x4489), returning `durationTicks * timecodeScale / 1e6` ms.
   */
  private probeMatroska(buffer: Buffer): number | null {
    const timecodeScaleNs = this.readMatroskaUint(buffer, [0x2a, 0xd7, 0xb1]) ?? 1_000_000;
    const durationTicks = this.readMatroskaFloat(buffer, [0x44, 0x89]);
    if (durationTicks === null || durationTicks <= 0 || timecodeScaleNs <= 0) {
      return null;
    }
    const durationNs = durationTicks * timecodeScaleNs;
    return Math.round(durationNs / 1_000_000);
  }

  /** Find an EBML element id (raw id bytes) and return the offset just past the size descriptor. */
  private findEbmlValue(buffer: Buffer, id: readonly number[]): { start: number; len: number } | null {
    const idBuf = Buffer.from(id);
    const idx = buffer.indexOf(idBuf);
    if (idx < 0) {
      return null;
    }
    const sizeOffset = idx + idBuf.length;
    if (sizeOffset >= buffer.length) {
      return null;
    }
    const first = buffer[sizeOffset] ?? 0;
    const lengthBytes = this.ebmlVintLength(first);
    if (lengthBytes === 0 || sizeOffset + lengthBytes > buffer.length) {
      return null;
    }
    const len = this.ebmlVintValue(buffer, sizeOffset, lengthBytes);
    return { start: sizeOffset + lengthBytes, len };
  }

  /** Read an unsigned-integer EBML element value (used for TimecodeScale). */
  private readMatroskaUint(buffer: Buffer, id: readonly number[]): number | null {
    const found = this.findEbmlValue(buffer, id);
    if (!found || found.len <= 0 || found.len > 8 || found.start + found.len > buffer.length) {
      return null;
    }
    let value = 0;
    for (let i = 0; i < found.len; i += 1) {
      value = value * 256 + (buffer[found.start + i] ?? 0);
    }
    return value;
  }

  /** Read a 4- or 8-byte big-endian float EBML element value (used for Duration). */
  private readMatroskaFloat(buffer: Buffer, id: readonly number[]): number | null {
    const found = this.findEbmlValue(buffer, id);
    if (!found || found.start + found.len > buffer.length) {
      return null;
    }
    if (found.len === 4) {
      return buffer.readFloatBE(found.start);
    }
    if (found.len === 8) {
      return buffer.readDoubleBE(found.start);
    }
    return null;
  }

  /** Number of bytes in an EBML variable-length integer given its first byte (0 = invalid). */
  private ebmlVintLength(first: number): number {
    for (let mask = 0x80, len = 1; mask > 0; mask >>= 1, len += 1) {
      if ((first & mask) !== 0) {
        return len;
      }
    }
    return 0;
  }

  /** Decode the numeric value of an EBML variable-length integer (size descriptor). */
  private ebmlVintValue(buffer: Buffer, offset: number, lengthBytes: number): number {
    const first = buffer[offset] ?? 0;
    let value = first & (0xff >> lengthBytes);
    for (let i = 1; i < lengthBytes; i += 1) {
      value = value * 256 + (buffer[offset + i] ?? 0);
    }
    return value;
  }
}
