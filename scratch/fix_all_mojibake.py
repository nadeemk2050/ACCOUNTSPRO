import os
import glob
import re
import sys

# Ensure stdout uses utf-8
sys.stdout.reconfigure(encoding='utf-8')

def fix_mojibake(match):
    s = match.group(0)
    try:
        original_bytes = s.encode('cp1252')
        fixed_s = original_bytes.decode('utf-8')
        return fixed_s
    except Exception:
        return s

def process_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        text = f.read()

    def replace_block(match):
        s = match.group(0)
        try:
            return s.encode('cp1252').decode('utf-8')
        except:
            return s
            
    new_text = re.sub(r'[^\x00-\x7F]+', replace_block, text)
    
    if new_text != text:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(new_text)
        return True
    return False

if __name__ == '__main__':
    src_dir = r"c:\app2026\accountspro\src"
    changed_files = []
    for root, dirs, files in os.walk(src_dir):
        for name in files:
            if name.endswith(('.jsx', '.js', '.html')):
                filepath = os.path.join(root, name)
                try:
                    if process_file(filepath):
                        changed_files.append(filepath)
                except Exception as e:
                    pass
                    
    print("Fixed files:", len(changed_files))
    for f in changed_files:
        print(" -", f)
