# Copyright 2026 wave789
# SPDX-License-Identifier: Apache-2.0
from pathlib import Path
from shutil import copyfile
from zipfile import ZipFile, ZIP_DEFLATED

with ZipFile('package.zip', 'w', ZIP_DEFLATED) as archive:
    for path in sorted(Path('dist').iterdir()):
        if path.is_file():
            archive.write(path, path.name)
copyfile('package.zip', 'siyuan-minimap.zip')
print('已生成 package.zip（GitHub Release / 集市）及 siyuan-minimap.zip（相同内容）')
