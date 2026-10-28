"""生成应用自己的几何图标（仅使用标准库，无外部素材）。"""
from pathlib import Path
import struct
import zlib


def png(size):
    pixels = bytearray()
    for y in range(size):
        pixels.append(0)
        for x in range(size):
            px, py = x / size, y / size
            inside = .08 < px < .92 and .06 < py < .94
            color = (105, 86, 206, 255) if inside else (0, 0, 0, 0)
            if .29 < px < .71 and .21 < py < .79:
                color = (255, 255, 255, 255)
            if .36 < px < .64 and any(a < py < a + .025 for a in [.40, .51, .62]):
                color = (156, 141, 226, 255)
            if .59 < px < .72 and .20 < py < .34 and py < px - .38:
                color = (105, 86, 206, 255)
            pixels.extend(color)

    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))

    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(bytes(pixels), 9)) + chunk(b'IEND', b'')


if __name__ == '__main__':
    folder = Path(__file__).resolve().parent.parent / 'src-tauri' / 'icons'
    folder.mkdir(parents=True, exist_ok=True)
    image = png(256)
    (folder / 'icon.png').write_bytes(image)
    (folder / 'icon.ico').write_bytes(struct.pack('<HHH', 0, 1, 1) + struct.pack('<BBBBHHII', 0, 0, 0, 0, 1, 32, len(image), 22) + image)
    image = png(512)
    (folder / 'icon.icns').write_bytes(b'icns' + struct.pack('>I', len(image) + 16) + b'ic09' + struct.pack('>I', len(image) + 8) + image)
    print('已生成 Windows、macOS 和 Linux 图标。')
