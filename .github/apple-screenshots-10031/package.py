"""Preserve native originals and make RGB copies without changing visible pixels."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import zipfile

from PIL import Image, PngImagePlugin

SOURCE = '6151ee8a341c0e5cffe1a7f4b95ded2f3d004ba7'
TREE = 'a60f2c9a3af029df5fa727b244ad7fa21706f85b'
REPO = 'fadhelcarlos/sideout-releases'
NAMES = ['01-inicio', '02-torneos', '03-torneito', '04-ranking', '05-canchas', '06-perfil', '07-mesa']
INPUTS = [
    (11991127578, 38768736368, '25589f4965a1983510ac6e1d5194cba61893b148', 'e4352f0256cb7e1e8452a02d123ad411c9da17964f47ecf3d3f8ab3d0795b948'),
    (11991379546, 38771900024, 'e51197417cecd54ae0d8722485d2257d26326608', '716d3eb3d202b62fa0e277b22424af8cf77b78463319ea876de7a56950b29136'),
]
EXECUTABLE = '446bc286aa8041870802ab779e9aaec50678179f5a59b0261debc36d925f874d'
BUNDLE = '05dca92015ecf59a7d94d314b5371446c19bdc7066669e93d7d8175bb5ea61dc'

def sha(data):
    return hashlib.sha256(data).hexdigest()

def api(route):
    return subprocess.check_output(['gh', 'api', f'repos/{REPO}/{route}'], timeout=180)

def save_json(path, data):
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')

def main():
    args = argparse.ArgumentParser()
    args.add_argument('--cache', type=Path)
    args.add_argument('--output', type=Path, required=True)
    options = args.parse_args()
    out = options.output
    out.mkdir(parents=True, exist_ok=False)
    for directory in ['raw', 'screenshots', 'provenance']:
        (out / directory).mkdir()
    records = {}
    inputs = []
    for artifact_id, run, head, digest in INPUTS:
        meta = json.loads(api(f'actions/artifacts/{artifact_id}'))
        assert not meta['expired'] and meta['digest'] == 'sha256:' + digest
        assert meta['workflow_run']['id'] == run and meta['workflow_run']['head_sha'] == head
        archive = options.cache / f'artifact-{artifact_id}.zip' if options.cache else None
        data = archive.read_bytes() if archive and archive.exists() else api(f'actions/artifacts/{artifact_id}/zip')
        assert sha(data) == digest
        provenance = out / 'provenance' / str(run)
        provenance.mkdir()
        save_json(provenance / 'artifact.json', meta)
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            retrieval = json.loads(z.read('retrieval.json'))
            app = json.loads(z.read('simulator-app.json'))
            simulator = json.loads(z.read('simulator-selection.json'))
            assert retrieval['source'] == SOURCE and retrieval['sourceTree'] == TREE
            assert retrieval['artifactId'] == 11960966485 and retrieval['buildRun'] == 38708886820
            assert app['source'] == SOURCE and app['version'] == '1.0.28' and app['build'] == '10031'
            assert app['executableSha256'] == EXECUTABLE and app['jsBundleSha256'] == BUNDLE
            assert app['platforms'] == ['iPhoneSimulator'] and app['localBackend'] is True
            assert simulator['deviceName'] == 'iPhone 16 Pro Max' and simulator['pixels'] == [1320, 2868]
            for name in ['retrieval.json', 'simulator-app.json', 'simulator-selection.json', 'xcode-version.txt', 'captures.jsonl', 'navigation/maestro.log']:
                (provenance / Path(name).name).write_bytes(z.read(name))
            captures = [json.loads(line) for line in z.read('captures.jsonl').splitlines()]
            for capture in captures:
                filename = capture['file']
                assert filename in [n + '.png' for n in NAMES] and filename not in records
                raw = z.read('screenshots/' + filename)
                assert sha(raw) == capture['sha256'] and len(raw) == capture['bytes']
                assert capture['method'] == 'xcrun simctl io screenshot' and capture['postProcessing'] is False
                assert raw[:8] == b'\x89PNG\r\n\x1a\n' and raw[24] == 8 and raw[25] == 6
                image = Image.open(io.BytesIO(raw))
                assert image.size == (1320, 2868) and image.mode == 'RGBA'
                assert image.getchannel('A').getextrema() == (255, 255), 'Nonopaque pixels require separate review'
                rgb = image.convert('RGB')
                pnginfo = PngImagePlugin.PngInfo()
                if 'srgb' in image.info:
                    pnginfo.add(b'sRGB', bytes([image.info['srgb']]))
                output = io.BytesIO()
                rgb.save(output, format='PNG', pnginfo=pnginfo, exif=image.info.get('exif', b''), icc_profile=image.info.get('icc_profile'))
                rgb_bytes = output.getvalue()
                decoded = Image.open(io.BytesIO(rgb_bytes))
                assert decoded.mode == 'RGB' and decoded.size == image.size and rgb_bytes[25] == 2
                assert decoded.tobytes() == rgb.tobytes(), 'Visible pixels changed'
                (out / 'raw' / filename).write_bytes(raw)
                (out / 'screenshots' / filename).write_bytes(rgb_bytes)
                records[filename] = {**capture, 'sourceArtifact': artifact_id, 'sourceRun': run,
                    'rawSha256': sha(raw), 'rawBytes': len(raw), 'sha256': sha(rgb_bytes), 'bytes': len(rgb_bytes),
                    'colorType': 2, 'rawColorType': 6, 'hasAlphaOrTransparency': False,
                    'rawAlphaExtrema': [255, 255], 'rgbPixelSha256': sha(rgb.tobytes()),
                    'pixelIdentical': True, 'postProcessing': 'Remove fully opaque alpha channel only; preserve RGB pixels and dimensions'}
        inputs.append({'artifactId': artifact_id, 'run': run, 'runner': head, 'sha256': digest})
    assert set(records) == {n + '.png' for n in NAMES}
    manifest = {'source': SOURCE, 'sourceTree': TREE, 'version': '1.0.28', 'build': '10031',
        'bundleId': 'com.sideoutpr.app', 'run': os.environ.get('GITHUB_RUN_ID'), 'runner': os.environ.get('GITHUB_SHA'),
        'inputs': inputs, 'device': 'iPhone 16 Pro Max', 'pixels': [1320, 2868],
        'screenshots': [records[n + '.png'] for n in NAMES], 'productCodeChanges': False,
        'scope': 'Seven authentic iOS Simulator screens; raw originals retained; RGB delivery pixels identical',
        'manualVisualReview': 'Parent reviewed all seven originals; independent receipt held in audit ledger'}
    save_json(out / 'screenshot-manifest.json', manifest)
    (out / 'README.txt').write_text('Upload only the seven PNGs in screenshots/, in numerical order.\n'
        'raw/ preserves the original Simulator bytes. RGB copies only remove a fully opaque alpha channel.\n'
        'No UI composition, resizing, cropping, status-bar replacement, product changes or Apple submission.\n', encoding='utf-8')
    print('SEVEN_NATIVE_RGB_PIXEL_IDENTICAL')

if __name__ == '__main__':
    main()
