"""Check the pinned project skill copies without executing third-party assets."""

import hashlib
import json
from pathlib import Path
import re
import sys


def main():
    root = Path(__file__).resolve().parent
    lock = json.loads((root / 'skills.lock.json').read_text(encoding='utf-8'))
    if lock['version'] != 1:
        raise ValueError('Unsupported skill lock version')
    skills_root = root / 'skills'
    names = set()
    total_files = 0
    for entry in lock['skills']:
        name = entry['name']
        if not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', name) or name in names:
            raise ValueError('Invalid or duplicate skill name: ' + name)
        names.add(name)
        if not re.fullmatch(r'[0-9a-f]{40}', entry['commit']):
            raise ValueError('Skill version must be a complete Git commit: ' + name)
        folder = skills_root / name
        body = (folder / 'SKILL.md').read_text(encoding='utf-8')
        frontmatter = body.split('---', 2)
        if len(frontmatter) != 3 or frontmatter[0].strip():
            raise ValueError('Missing skill frontmatter: ' + name)
        if not re.search(r'^name:\s*' + re.escape(name) + r'\s*$', frontmatter[1], re.M):
            raise ValueError('Skill name does not match folder: ' + name)
        if not re.search(r'^description:\s*\S', frontmatter[1], re.M):
            raise ValueError('Missing skill description: ' + name)
        expected_files = {file['path']: file['sha256'] for file in entry['files']}
        if len(expected_files) != len(entry['files']):
            raise ValueError('Duplicate file entry: ' + name)
        actual_files = {}
        for path in folder.rglob('*'):
            if path.is_symlink():
                raise ValueError('Unexpected symlink: ' + str(path))
            if path.is_file():
                actual_files[path.relative_to(folder).as_posix()] = hashlib.sha256(path.read_bytes()).hexdigest()
        if actual_files != expected_files:
            changed = sorted(path for path in set(actual_files) | set(expected_files) if actual_files.get(path) != expected_files.get(path))
            raise ValueError('Skill files differ from reviewed version: ' + name + ': ' + ', '.join(changed))
        if not entry['licenseFiles'] or not all(path in actual_files for path in entry['licenseFiles']):
            raise ValueError('Missing license evidence: ' + name)
        for target in re.findall(r'\]\(([^\s)]+)\)', body):
            if '://' in target or target.startswith(('#', 'mailto:')):
                continue
            if not (folder / target.split('#')[0]).is_file():
                raise ValueError('Missing skill reference: ' + name + ': ' + target)
        total_files += len(actual_files)
    if {path.name for path in skills_root.iterdir()} != names:
        raise ValueError('Skill directories differ from lock file')
    print(f'Verified {len(names)} skills and {total_files} files against pinned source checksums.')


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, KeyError) as error:
        print('Skill verification failed:', error, file=sys.stderr)
        sys.exit(1)
