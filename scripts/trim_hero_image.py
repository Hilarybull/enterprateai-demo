from PIL import Image
import os

# Paths
repo_root = os.path.dirname(os.path.dirname(__file__))
public = os.path.join(repo_root, 'frontend', 'public')
orig = os.path.join(public, 'hero-section-1.png')
backup = os.path.join(public, 'hero-section-1.orig.png')
clean = os.path.join(public, 'hero-section-1-clean.png')

CROP_PX = 6  # pixels to trim from each edge; adjust if needed

if not os.path.exists(orig):
    raise SystemExit(f"Source image not found: {orig}")

# Make a backup if not already present
if not os.path.exists(backup):
    print('Creating backup:', backup)
    os.replace(orig, backup)
    src_path = backup
else:
    print('Backup already exists, using backup as source')
    src_path = backup

print('Opening', src_path)
img = Image.open(src_path)
width, height = img.size
print('Original size:', width, 'x', height)

# Compute crop box while ensuring we don't produce invalid box
left = CROP_PX
upper = CROP_PX
right = max(left + 1, width - CROP_PX)
lower = max(upper + 1, height - CROP_PX)

print('Crop box:', (left, upper, right, lower))
trimmed = img.crop((left, upper, right, lower))
trimmed.save(clean)
print('Saved cleaned image to', clean)

# Replace public image with cleaned version
os.replace(clean, orig)
print('Replaced public image with cleaned version:', orig)
