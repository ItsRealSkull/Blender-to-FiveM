"""
Blender headless export script.
Usage: blender --background model.blend --python export_to_gltf.py -- output.glb
"""
import bpy
import sys

def main():
    # Get arguments after '--'
    argv = sys.argv
    separator_index = argv.index("--") if "--" in argv else -1

    if separator_index == -1 or separator_index + 1 >= len(argv):
        print("ERROR: No output path specified. Usage: blender --background file.blend --python export_to_gltf.py -- output.glb")
        sys.exit(1)

    output_path = argv[separator_index + 1]

    # Select all mesh objects
    bpy.ops.object.select_all(action='DESELECT')
    for obj in bpy.data.objects:
        if obj.type == 'MESH':
            obj.select_set(True)

    # Export to glTF binary
    bpy.ops.export_scene.gltf(
        filepath=output_path,
        export_format='GLB',
        use_selection=False,
        export_apply_modifiers=True,
        export_texcoords=True,
        export_normals=True,
        export_colors=True,
        export_materials='EXPORT',
        export_image_format='AUTO',
        export_draco_mesh_compression_enable=False,
        export_yup=True
    )

    print(f"SUCCESS: Exported to {output_path}")

if __name__ == "__main__":
    main()
