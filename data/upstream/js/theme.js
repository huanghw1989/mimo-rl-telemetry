/* Runs before first paint (synchronous, in <head>): pick the theme so the page
   does not flash. Kept in a file so the page needs no inline script under CSP. */
(function () {
  "use strict";
  var t = new URLSearchParams(location.search).get("theme") || localStorage.getItem("theme");
  if (t !== "dark" && t !== "light") t = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  document.documentElement.dataset.theme = t;
})();
