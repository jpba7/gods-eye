- Add a Performance toggle to the visual controls for heavy 3D tiles. It
  swaps MSAA 4x for FXAA and raises `maximumScreenSpaceError` from 16 to 32
  on every 3D tileset, including ones added later, then restores the previous
  values when switched off. The choice is remembered on the device (#7).
