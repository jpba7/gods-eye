- Fix three Earth shell drawer faults. Icons in section panels rendered as
  their names ("radar", "draw") because the shell's sans-serif rule overrode
  the Material Symbols font; the rail layout engine still budgeted space for
  the hidden Tactical HUD and auto-collapsed the panels an open drawer shows,
  which left Scenes empty; and its focus layout sized the rail past the
  status bar, so a drawer's last controls could not be scrolled into view
  (#8).
