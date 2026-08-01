'use strict';

// Remove only leading emoji grapheme clusters; the cron name itself is never changed.
function stripLeadingEmoji(name) {
  const value = String(name == null ? '' : name);
  if (!value) return value;
  const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
  const clusters = segmenter
    ? Array.from(segmenter.segment(value), part => part.segment)
    : Array.from(value);
  let index = 0;
  while (index < clusters.length && /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(clusters[index])) index += 1;
  return clusters.slice(index).join('').replace(/^\s+/, '');
}

if (typeof module !== 'undefined') module.exports = { stripLeadingEmoji };
