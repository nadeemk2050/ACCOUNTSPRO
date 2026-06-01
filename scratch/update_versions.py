import os
import re

files = [
    r"c:\app2026\accountspro\src\App.jsx",
    r"c:\app2026\accountspro\src\10MAY\App.jsx",
    r"c:\app2026\accountspro\src\23MAY26\App.jsx",
    r"c:\app2026\accountspro\src\31may\App.jsx",
    r"c:\app2026\accountspro\src\ManagementDashboard.jsx",
    r"c:\app2026\accountspro\src\RegistersDashboard.jsx",
    r"c:\app2026\accountspro\src\ReportsV2.jsx",
    r"c:\app2026\accountspro\src\UserManualModal.jsx",
    r"c:\app2026\accountspro\scratch\api_tester.html"
]

for f in files:
    if os.path.exists(f):
        with open(f, 'r', encoding='utf-8') as file:
            content = file.read()
        
        # Replacements
        content = re.sub(r'2\.6\.2', '2.6.3', content)
        content = re.sub(r'2\.5\.1', '2.6.3', content)
        content = re.sub(r'2\.5\.3', '2.6.3', content)
        content = re.sub(r'v 2\.5\b', 'v 2.6.3', content)
        
        with open(f, 'w', encoding='utf-8') as file:
            file.write(content)

print("Versions updated.")
