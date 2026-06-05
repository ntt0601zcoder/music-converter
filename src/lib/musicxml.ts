// Serialize a QuantizedScore into MusicXML 4.0 (score-partwise).
//
// A grand staff (piano) is one <part> with <staves>2</staves>: voice 1 on the
// treble staff, voice 2 on the bass staff, separated by a <backup>. Renderers
// (incl. Verovio) draw the brace automatically.

import type { MeasureElement, QuantizedScore, StaffNotation } from './quantize';
import { keyUsesFlats, spellMidi } from './music';

const COMPOSER = 'Tự động chuyển từ audio (Basic Pitch)';

export interface MusicXmlMeta {
  title?: string;
  partName?: string;
}

export function scoreToMusicXml(score: QuantizedScore, meta: MusicXmlMeta = {}): string {
  const title = meta.title?.trim() || 'Bản ký âm tự động';
  const partName = meta.partName?.trim() || (score.settings.mode === 'piano' ? 'Piano' : 'Nhạc cụ');
  const useFlats = keyUsesFlats(score.settings.keyFifths);
  const isGrand = score.staves.length > 1;

  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" ' +
      '"http://www.musicxml.org/dtds/partwise.dtd">',
  );
  lines.push('<score-partwise version="4.0">');
  lines.push(`  <work><work-title>${esc(title)}</work-title></work>`);
  lines.push('  <identification>');
  lines.push(`    <creator type="composer">${esc(COMPOSER)}</creator>`);
  lines.push('    <encoding><software>audio2sheet (web)</software></encoding>');
  lines.push('  </identification>');
  lines.push('  <part-list>');
  lines.push(`    <score-part id="P1"><part-name>${esc(partName)}</part-name></score-part>`);
  lines.push('  </part-list>');
  lines.push('  <part id="P1">');

  for (let m = 0; m < score.numberOfMeasures; m++) {
    lines.push(`    <measure number="${m + 1}">`);
    if (m === 0) {
      lines.push(...attributesXml(score, isGrand));
    }
    // Treble staff (voice 1, staff 1).
    appendStaffMeasure(lines, score.staves[0], m, 1, isGrand ? 1 : null, useFlats);
    // Bass staff (voice 2, staff 2), after a backup to the bar start.
    if (isGrand && score.staves[1]) {
      lines.push(`      <backup><duration>${score.divisionsPerMeasure}</duration></backup>`);
      appendStaffMeasure(lines, score.staves[1], m, 2, 2, useFlats);
    }
    lines.push('    </measure>');
  }

  lines.push('  </part>');
  lines.push('</score-partwise>');
  return lines.join('\n');
}

function attributesXml(score: QuantizedScore, isGrand: boolean): string[] {
  const out: string[] = [];
  out.push('      <attributes>');
  out.push(`        <divisions>${score.divisions}</divisions>`);
  out.push(`        <key><fifths>${score.settings.keyFifths}</fifths></key>`);
  out.push(
    `        <time><beats>${score.settings.beats}</beats>` +
      `<beat-type>${score.settings.beatType}</beat-type></time>`,
  );
  if (isGrand) {
    out.push(`        <staves>${score.staves.length}</staves>`);
    score.staves.forEach((staff, i) => out.push(clefXml(staff.clef, i + 1)));
  } else {
    out.push(clefXml(score.staves[0].clef, null));
  }
  out.push('      </attributes>');
  return out;
}

function clefXml(clef: 'treble' | 'bass', staffNumber: number | null): string {
  const num = staffNumber != null ? ` number="${staffNumber}"` : '';
  if (clef === 'bass') return `        <clef${num}><sign>F</sign><line>4</line></clef>`;
  return `        <clef${num}><sign>G</sign><line>2</line></clef>`;
}

function appendStaffMeasure(
  lines: string[],
  staff: StaffNotation,
  measureIndex: number,
  voice: number,
  staffNumber: number | null,
  useFlats: boolean,
): void {
  const elements = staff.measures[measureIndex] ?? [];
  for (const el of elements) {
    lines.push(...noteElementXml(el, voice, staffNumber, useFlats));
  }
}

function noteElementXml(
  el: MeasureElement,
  voice: number,
  staffNumber: number | null,
  useFlats: boolean,
): string[] {
  const out: string[] = [];
  const dots = '<dot/>'.repeat(el.dots);

  if (el.isRest) {
    const staffTag = staffNumber != null ? `<staff>${staffNumber}</staff>` : '';
    out.push('      <note>');
    out.push('        <rest/>');
    out.push(`        <duration>${el.durationUnits}</duration>`);
    out.push(`        <voice>${voice}</voice>`);
    out.push(`        <type>${el.type}</type>`);
    if (dots) out.push(`        ${dots}`);
    if (staffTag) out.push(`        ${staffTag}`);
    out.push('      </note>');
    return out;
  }

  const pitches = el.midis;
  pitches.forEach((midi, idx) => {
    const { step, alter, octave } = spellMidi(midi, useFlats);
    out.push('      <note>');
    if (idx > 0) out.push('        <chord/>');
    out.push('        <pitch>');
    out.push(`          <step>${step}</step>`);
    if (alter !== 0) out.push(`          <alter>${alter}</alter>`);
    out.push(`          <octave>${octave}</octave>`);
    out.push('        </pitch>');
    out.push(`        <duration>${el.durationUnits}</duration>`);
    if (el.tieStop) out.push('        <tie type="stop"/>');
    if (el.tieStart) out.push('        <tie type="start"/>');
    out.push(`        <voice>${voice}</voice>`);
    out.push(`        <type>${el.type}</type>`);
    if (dots) out.push(`        ${dots}`);
    if (staffNumber != null) out.push(`        <staff>${staffNumber}</staff>`);
    if (el.tieStop || el.tieStart) {
      out.push('        <notations>');
      if (el.tieStop) out.push('          <tied type="stop"/>');
      if (el.tieStart) out.push('          <tied type="start"/>');
      out.push('        </notations>');
    }
    out.push('      </note>');
  });
  return out;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
