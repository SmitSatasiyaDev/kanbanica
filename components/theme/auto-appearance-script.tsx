"use client";

// The `auto` appearance is the only case the server can't decide — it depends on
// the visitor's `prefers-color-scheme`. Everything else (the `dark` class and the
// `data-theme` palette) is already in the server HTML, so this script never runs
// for an explicit light/dark choice and there is nothing to flash.
const AUTO_APPEARANCE_SCRIPT = `(function(){try{
var el=document.documentElement;
if(el.dataset.appearance!=='auto')return;
var dark=window.matchMedia('(prefers-color-scheme: dark)').matches;
el.classList.toggle('dark',dark);
}catch(e){}})();`;

/**
 * A RAW <script>, not next/script. `strategy="beforeInteractive"` does not emit an
 * executable inline script — it serialises the source into `self.__next_s` for the Next
 * bootstrap to run *after* the framework JS loads, i.e. long after first paint, which is
 * what made dark mode flash white. A plain script executes during HTML parse, before the
 * page below it is painted.
 *
 * This must be a *client* component: React 19 warns when it client-renders a <script>
 * (e.g. on RSC refreshes). The server HTML already holds the executable copy, so on the
 * client we emit a non-JS `type`, which React treats as an inert data block. In a server
 * component `typeof window` is always "undefined", so that switch never took effect.
 */
export function AutoAppearanceScript() {
  return (
    <script
      // biome-ignore lint/security/noDangerouslySetInnerHtml: static, non-user-controlled snippet that must run before first paint.
      dangerouslySetInnerHTML={{ __html: AUTO_APPEARANCE_SCRIPT }}
      suppressHydrationWarning
      type={typeof window === "undefined" ? undefined : "application/json"}
    />
  );
}
