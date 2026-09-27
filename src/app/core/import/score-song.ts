import * as alphaTab from '@coderline/alphatab';
import { applyPianoMix } from '../sequence/piano-mix';
import { sequenceScore } from '../sequence/sequence-score';
import { LoadedSong, SongFormat, summarizeTracks } from '../song';

/** Wraps an alphaTab Score (from any importer) as a LoadedSong. */
export function scoreToSong(
  score: alphaTab.model.Score,
  settings: alphaTab.Settings,
  format: SongFormat,
): LoadedSong {
  const seq = sequenceScore(score, settings);
  const tracks = summarizeTracks(
    score.tracks.map((t) => ({
      index: t.index,
      name: t.name || `Track ${t.index + 1}`,
      program: t.playbackInfo.program,
      isPercussion: t.staves.some((s) => s.isPercussion),
      channels: [...new Set([t.playbackInfo.primaryChannel, t.playbackInfo.secondaryChannel])],
      mutedInFile: t.playbackInfo.isMute,
    })),
    seq.notes,
  );
  return {
    format,
    title: score.title,
    artist: score.artist,
    score,
    tracks,
    notes: seq.notes,
    tempos: seq.tempos,
    timeSignatures: seq.timeSignatures,
    bars: seq.bars,
    chords: seq.chords,
    endTick: seq.endTick,
    buildMidi: (pianoTracks) => {
      const midi = sequenceScore(score, settings).midiFile;
      const pianoChannels = new Set(
        tracks
          .filter((t) => pianoTracks.has(t.index) && !t.isPercussion)
          .flatMap((t) => t.channels),
      );
      applyPianoMix(alphaTab, midi, pianoChannels);
      return midi;
    },
  };
}
