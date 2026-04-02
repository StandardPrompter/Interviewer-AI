import os

files = [
    'backend/functions/interviewer_research/app.py',
    'backend/functions/post_interview_insight/app.py'
]

for f in files:
    if not os.path.exists(f): 
        print(f"File {f} not found.")
        continue
    
    try:
        # Read the file with errors='ignore' to handle any non-utf8 characters
        with open(f, 'r', encoding='utf-8', errors='ignore') as file:
            lines = file.readlines()
        
        new_lines = []
        in_conflict = False
        keep_current_block = False # Switch to True when we are in the block we want to keep
        
        for line in lines:
            if line.startswith('<<<<<<<'):
                in_conflict = True
                keep_current_block = False # Skip the HEAD block
            elif line.startswith('======='):
                keep_current_block = True # Keep our commit block
            elif line.startswith('>>>>>>>'):
                in_conflict = False
                keep_current_block = False
            else:
                if not in_conflict or keep_current_block:
                    new_lines.append(line)
        
        with open(f, 'w', encoding='utf-8') as file:
            file.writelines(new_lines)
        print(f"Resolved conflicts in {f} (kept our changes).")
    except Exception as e:
        print(f"Error processing {f}: {e}")
