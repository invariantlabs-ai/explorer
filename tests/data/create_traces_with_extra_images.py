import json
import base64

# Number of copies of the image object to add
NUM_PICTURE_ADD = 5

# Filename of the original JSON file (must contain a JSON array)
input_filename = "trace_with_10_images.jsonl"

# Filename for the output file with the copied image parts
output_filename = f"trace_with_{NUM_PICTURE_ADD+10}_images.jsonl"

# Read the JSON data from the file
with open(input_filename, "r", encoding="utf-8") as infile:
    data = json.loads(infile.read())

# Read jpeg image
def create_trace_with_jpeg():
    with open("jpeg_example.jpg", "rb") as f:
        jpeg_data = f.read()
        return base64.b64encode(jpeg_data).decode("utf-8")

base64_jpg = create_trace_with_jpeg()

# Find the object that holds the image data.
# Looks for an object with role "tool" whose content contains "local_base64_img:"
image_object = None
message_object = None
for item in data:
    if item.get("role") == "tool":
        content = item.get("content", "")
        if isinstance(content, str) and "local_base64_img:" in content:
            # Replace the content with the base64 encoded jpeg
            # item["content"] = f"local_base64_img: {base64_jpg}"
            image_object = item
            break

if image_object is None:
    print("No image object found in the data.")
    exit(1)

# Make num copies of the image object and write it to the output file
for _ in range(NUM_PICTURE_ADD):
    data.append(image_object.copy())

with open(output_filename, "w", encoding="utf-8") as outfile:
    outfile.write(json.dumps(data))

print(f"{NUM_PICTURE_ADD} more copies of the image object have been written to '{output_filename}'.")
