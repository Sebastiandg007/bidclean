import { Injectable, Logger } from '@nestjs/common';

/**
 * Bytes-based audio duration probe.
 *
 * Reads the real playback duration from a downloaded audio buffer by parsing its container/codec
 * metadata — the SERVER-AUTHORITATIVE duration used to bound a voice note (the client-declared
 * value is advisory only). This deliberately avoids a heavyweight media dependency: it parses the
 * two self-describing formats we can read exactly from headers (WAV via its `fmt `/`data` chunks,
 * and MPEG audio via frame headers), and returns `null` for any buffer it cannot confidently probe
 * as valid audio — the caller treats a `null` duration as an invalid/unsupported object (400),
 * never as "unbounded". It is a NestJS provider so it can be swapped/mocked in tests.
 *
 * Never logs audio bytes; only structural parse outcomes.
 */
@Injectable()
export class AudioDurationProbe {
  private readonly logger = new Logger(AudioDurationProbe.name);

  /** RIFF/WAVE container magic ("RIFF" .... "WAVE"). */
  private static readonly RIFF = 0x52494646; // 'RIFF'
  private static readonly WAVE = 0x57415645; // 'WAVE'
  private static readonly MS_PER_SECOND = 1000;

  /**
   * Probe the real duration of an audio buffer in milliseconds.
   *
   * @param buffer Raw audio bytes downloaded from storage.
   * @param contentType Server-observed content type (used to pick a parser).
   * @returns Duration in milliseconds, or `null` when the buffer is not confidently probeable.
   */
  probe(buffer: Buffer, contentType: string): number | null {
    try {
      if (this.looksLikeWav(buffer)) {
        return this.probeWav(buffer);
      }
      if (this.looksLikeMpeg(buffer, contentType)) {
        return this.probeMpeg(buffer);
      }
      // Unknown/unsupported container — not confidently probeable.
      return null;
    } catch {
      // A malformed buffer is treated as unprobeable (never throws to the caller).
      this.logger.warn('Audio duration probe failed for an object (treated as unprobeable)');
      return null;
    }
  }

  /** True when the buffer opens with a RIFF/WAVE header. */
  private looksLikeWav(buffer: Buffer): boolean {
    return (
      buffer.length >= 12 &&
      buffer.readUInt32BE(0) === AudioDurationProbe.RIFF &&
      buffer.readUInt32BE(8) === AudioDurationProbe.WAVE
    );
  }

  /**
   * Exact WAV duration from the `fmt ` chunk (byte rate) and the `data` chunk (size):
   * durationSeconds = dataBytes / byteRate.
   */
  private probeWav(buffer: Buffer): number | null {
    let offset = 12; // past RIFF header
    let byteRate = 0;
    let dataBytes = 0;

    while (offset + 8 <= buffer.length) {
      const chunkId = buffer.toString('ascii', offset, offset + 4);
      const chunkSize = buffer.readUInt32LE(offset + 4);
      const bodyStart = offset + 8;

      if (chunkId === 'fmt ' && bodyStart + 16 <= buffer.length) {
        byteRate = buffer.readUInt32LE(bodyStart + 8);
      } else if (chunkId === 'data') {
        dataBytes = chunkSize;
      }

      // Chunks are word-aligned (pad byte when size is odd).
      offset = bodyStart + chunkSize + (chunkSize % 2);
    }

    if (byteRate <= 0 || dataBytes <= 0) {
      return null;
    }
    return Math.round((dataBytes / byteRate) * AudioDurationProbe.MS_PER_SECOND);
  }

  /** True for MPEG audio (mp3): an ID3 tag or an MPEG frame sync at the start. */
  private looksLikeMpeg(buffer: Buffer, contentType: string): boolean {
    if (buffer.length < 4) {
      return false;
    }
    const hasId3 = buffer.toString('ascii', 0, 3) === 'ID3';
    const hasFrameSync = buffer[0] === 0xff && ((buffer[1] ?? 0) & 0xe0) === 0xe0;
    return hasId3 || hasFrameSync || contentType === 'audio/mpeg';
  }

  /**
   * MPEG audio duration by summing frame durations. Walks frame headers; for a constant-bitrate
   * stream this is exact, for VBR it is a close estimate. Returns `null` if no valid frame is found.
   */
  private probeMpeg(buffer: Buffer): number | null {
    let offset = this.skipId3(buffer);
    let totalMs = 0;
    let frames = 0;

    while (offset + 4 <= buffer.length) {
      const header = this.parseMpegFrameHeader(buffer, offset);
      if (header === null) {
        offset += 1;
        // Bail out early if we never sync within a reasonable window and have no frames.
        if (frames === 0 && offset > 4096) {
          return null;
        }
        continue;
      }
      totalMs += (header.samplesPerFrame / header.sampleRate) * AudioDurationProbe.MS_PER_SECOND;
      frames += 1;
      offset += header.frameLengthBytes;
    }

    return frames > 0 ? Math.round(totalMs) : null;
  }

  /** Skip a leading ID3v2 tag if present, returning the offset of the first audio frame. */
  private skipId3(buffer: Buffer): number {
    if (buffer.length >= 10 && buffer.toString('ascii', 0, 3) === 'ID3') {
      // ID3v2 size is a 28-bit synchsafe integer in bytes 6..9.
      const b6 = buffer[6] ?? 0;
      const b7 = buffer[7] ?? 0;
      const b8 = buffer[8] ?? 0;
      const b9 = buffer[9] ?? 0;
      const size = (b6 << 21) | (b7 << 14) | (b8 << 7) | b9;
      return 10 + size;
    }
    return 0;
  }

  /** MPEG-1/2 bitrate tables (kbps) for Layer III, indexed by the 4-bit bitrate field. */
  private static readonly BITRATES_V1_L3 = [
    0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0,
  ];
  private static readonly BITRATES_V2_L3 = [
    0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0,
  ];
  /** Sample-rate tables (Hz), indexed by the 2-bit sample-rate field, per MPEG version. */
  private static readonly SAMPLE_RATES_V1 = [44100, 48000, 32000, 0];
  private static readonly SAMPLE_RATES_V2 = [22050, 24000, 16000, 0];
  private static readonly SAMPLE_RATES_V25 = [11025, 12000, 8000, 0];

  /**
   * Parse a single MPEG (Layer III) audio frame header at `offset`. Returns the frame length and
   * per-frame timing, or `null` when the four bytes are not a valid Layer III frame sync.
   */
  private parseMpegFrameHeader(
    buffer: Buffer,
    offset: number,
  ): { frameLengthBytes: number; samplesPerFrame: number; sampleRate: number } | null {
    const b0 = buffer[offset] ?? 0;
    const b1 = buffer[offset + 1] ?? 0;
    const b2 = buffer[offset + 2] ?? 0;

    if (b0 !== 0xff || (b1 & 0xe0) !== 0xe0) {
      return null;
    }

    const versionBits = (b1 >> 3) & 0x03; // 00=v2.5, 10=v2, 11=v1
    const layerBits = (b1 >> 1) & 0x03; // 01=Layer III
    if (layerBits !== 0x01) {
      return null; // only Layer III supported
    }

    const bitrateIndex = (b2 >> 4) & 0x0f;
    const sampleRateIndex = (b2 >> 2) & 0x03;
    const padding = (b2 >> 1) & 0x01;

    const isV1 = versionBits === 0x03;
    const bitrateTable = isV1
      ? AudioDurationProbe.BITRATES_V1_L3
      : AudioDurationProbe.BITRATES_V2_L3;
    const sampleRateTable =
      versionBits === 0x03
        ? AudioDurationProbe.SAMPLE_RATES_V1
        : versionBits === 0x02
          ? AudioDurationProbe.SAMPLE_RATES_V2
          : AudioDurationProbe.SAMPLE_RATES_V25;

    const bitrateKbps = bitrateTable[bitrateIndex] ?? 0;
    const sampleRate = sampleRateTable[sampleRateIndex] ?? 0;
    if (bitrateKbps <= 0 || sampleRate <= 0) {
      return null;
    }

    const samplesPerFrame = isV1 ? 1152 : 576;
    const bitrateBps = bitrateKbps * 1000;
    const frameLengthBytes = Math.floor(
      (samplesPerFrame * bitrateBps) / (8 * sampleRate) + padding,
    );
    if (frameLengthBytes <= 0) {
      return null;
    }

    return { frameLengthBytes, samplesPerFrame, sampleRate };
  }
}
