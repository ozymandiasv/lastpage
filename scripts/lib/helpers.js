'use strict';

const TAG_COLOURS = ['purple', 'amber', 'blue', 'green', 'pink', 'teal', 'red', 'gray'];

function tagColour(name) {
  let h = 0;
  for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return TAG_COLOURS[h % TAG_COLOURS.length];
}

function formatDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatMonthYear(d) {
  return new Date(d).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

function slugifyPath(str) {
  return String(str).toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
}

function readTime(wordCount) {
  return Math.max(1, Math.round(wordCount / 200));
}

function starRating(rating10) {
  // rating out of 10 -> 5 star scale, returns { full, half, empty }
  const stars = Math.round((rating10 / 10) * 5 * 2) / 2; // nearest 0.5
  const full = Math.floor(stars);
  const half = stars - full >= 0.5 ? 1 : 0;
  const empty = 5 - full - half;
  return { full, half, empty, value: stars };
}

module.exports = { tagColour, formatDate, formatMonthYear, slugifyPath, readTime, starRating, TAG_COLOURS };
