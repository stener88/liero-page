# Third-party notices

Liero.page's own code is MIT licensed (see `LICENSE`). It builds on the following work.

## Liero (game data)

Liero © 1998 Joosa Riekkinen. The original Liero data and binary files are released under the
WTFPL (see `liero-original/LICENSE.TXT`). Weapon, particle and material tables, sprites and the
palette in `shared/liero/data.gen.ts` are extracted from the original Liero 1.33 files.

The sound effects in `extension/src/game/liero-sounds.gen.ts` come from `LIERO.SND`, which
contains sounds from MoleZ (freeware, freely distributable).

## OpenLiero (game logic)

The game logic in `shared/liero/` is a TypeScript port of OpenLiero's `worm.cpp`, `weapon.cpp`,
`nobject.cpp`, `sobject.cpp`, `bobject.cpp` and `ninjarope.cpp`, and the data extraction follows its
exe reader. OpenLiero is licensed under the BSD-2-Clause license
(https://github.com/openliero/openliero):

    Copyright (c) Erik Lindroos and OpenLiero contributors
    All rights reserved.

    Redistribution and use in source and binary forms, with or without modification, are
    permitted provided that the following conditions are met:

    1. Redistributions of source code must retain the above copyright notice, this list of
       conditions and the following disclaimer.
    2. Redistributions in binary form must reproduce the above copyright notice, this list of
       conditions and the following disclaimer in the documentation and/or other materials
       provided with the distribution.

    THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS
    OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF
    MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE
    COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
    EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
    SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION)
    HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
    (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN
    IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

## Fonts

The landing page loads Press Start 2P and IBM Plex Mono from Google Fonts (SIL Open Font License).
