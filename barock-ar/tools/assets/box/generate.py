"""Runs on the Arch box. Two steps, each in its own process so the GPU is empty between them.
Seeds are comma lists; each step loads its model once and writes one file per seed.

  generate.py edit <in.png> <out-dir> <prompt-file> <seeds>        -> photo-s<seed>.png
  generate.py mesh <in.png> <out-dir> <head|prop> <seeds>          -> raw-s<seed>.glb, input.png
"""
import json
import os
import sys

os.environ.setdefault('HF_HOME', '/mnt/data/barock3d/hf')
os.environ.setdefault('HF_ENDPOINT', 'https://hf-mirror.com')
os.environ['PYTORCH_CUDA_ALLOC_CONF'] = 'expandable_segments:True'
os.environ['OPENCV_IO_ENABLE_OPENEXR'] = '1'

import torch
from PIL import Image

ROOT = os.path.expanduser('~/barock3d')
DINO = 'camenduru/dinov3-vitl16-pretrain-lvd1689m'  # ungated copy of facebook/dinov3-vitl16-pretrain-lvd1689m
REMBG = 'ZhengPeng7/BiRefNet'  # MIT; the default briaai/RMBG-2.0 is gated and non-commercial
BUDGET = {'head': dict(faces=92000, texture=2048), 'prop': dict(faces=56000, texture=1024)}


def edit(image_path, out_dir, prompt_path, seeds):
    # The NF4 text encoder and transformer load straight onto the GPU and do not fit 16 GB together,
    # so each stage encodes the prompt first, frees the encoder, then denoises from the embeddings.
    # The prompt file may hold several prompts separated by a line "---"; they run as a chain, and
    # every later stage gets a grey margin around its input so the subject ends up framed with space.
    import gc
    from diffusers import QwenImageEditPlusPipeline
    from diffusers.pipelines.qwenimage.pipeline_qwenimage_edit_plus import CONDITION_IMAGE_SIZE, calculate_dimensions
    from huggingface_hub import hf_hub_download
    from PIL import ImageOps

    repo = 'ovedrive/Qwen-Image-Edit-2511-4bit'
    prompts = [p.strip() for p in open(prompt_path).read().split('\n---\n')]
    first = Image.open(image_path).convert('RGB')
    images = {seed: first for seed in seeds}

    def flush():
        gc.collect()
        torch.cuda.empty_cache()

    for stage, prompt in enumerate(prompts):
        if stage:
            images = {s: ImageOps.expand(im, border=(im.width // 6, im.height // 8, im.width // 6, 0), fill=(200, 200, 200)) for s, im in images.items()}
        enc = QwenImageEditPlusPipeline.from_pretrained(repo, transformer=None, torch_dtype=torch.bfloat16)
        embeds = {}
        for s, im in images.items():
            w, h = calculate_dimensions(CONDITION_IMAGE_SIZE, im.width / im.height)
            with torch.inference_mode():
                e, m = enc.encode_prompt(prompt=prompt, image=[enc.image_processor.resize(im, h, w)], device='cuda')
            embeds[s] = (e.cpu(), None if m is None else m.cpu())
        del enc
        flush()

        pipe = QwenImageEditPlusPipeline.from_pretrained(repo, text_encoder=None, torch_dtype=torch.bfloat16)
        pipe.load_lora_weights(hf_hub_download('lightx2v/Qwen-Image-Edit-2511-Lightning', 'Qwen-Image-Edit-2511-Lightning-8steps-V1.0-bf16.safetensors'))
        pipe.vae.to('cuda')
        pipe.vae.enable_tiling()
        for s in seeds:
            e, m = embeds[s]
            with torch.inference_mode():
                images[s] = pipe(image=[images[s]], prompt_embeds=e.to('cuda'), prompt_embeds_mask=None if m is None else m.to('cuda'),
                                 true_cfg_scale=1.0, num_inference_steps=8, generator=torch.manual_seed(s)).images[0]
            torch.cuda.empty_cache()
        del pipe
        flush()
    for s, im in images.items():
        im.save(os.path.join(out_dir, f'photo-s{s}.png'))
    print('peak vram GB', round(torch.cuda.max_memory_allocated() / 1e9, 2))


def pipeline_dir():
    from huggingface_hub import hf_hub_download

    d = os.path.join(ROOT, 'pipeline')
    os.makedirs(d, exist_ok=True)
    cfg = json.load(open(hf_hub_download('microsoft/TRELLIS.2-4B', 'pipeline.json')))
    args = cfg['args']
    args['models'] = {k: (f'microsoft/TRELLIS.2-4B/{v}' if v.startswith('ckpts/') else v) for k, v in args['models'].items()}
    args['image_cond_model']['args']['model_name'] = DINO
    args['rembg_model']['args']['model_name'] = REMBG
    json.dump(cfg, open(os.path.join(d, 'pipeline.json'), 'w'), indent=1)
    return d


def mesh(image_path, out_dir, kind, seeds):
    sys.path.insert(0, os.path.join(ROOT, 'trellis2'))
    from trellis2.pipelines import Trellis2ImageTo3DPipeline
    from trellis2.representations.mesh.base import Mesh
    import o_voxel

    # CuMesh allocates with raw cudaMalloc and cannot see blocks parked in torch's cache, which OOMs on 16 GB.
    fill_holes = Mesh.fill_holes
    Mesh.fill_holes = lambda self, *a, **k: (torch.cuda.empty_cache(), fill_holes(self, *a, **k))[1]

    pipe = Trellis2ImageTo3DPipeline.from_pretrained(pipeline_dir())
    pipe.cuda()
    image = pipe.preprocess_image(Image.open(image_path))
    image.save(os.path.join(out_dir, 'input.png'))
    b = BUDGET[kind]
    for seed in seeds:
        m = pipe.run(image, seed=seed, preprocess_image=False, pipeline_type='1024_cascade')[0]
        m.simplify(3000000)  # remeshing or baking the full 16M-face output does not fit in 16 GB
        torch.cuda.empty_cache()
        glb = o_voxel.postprocess.to_glb(
            vertices=m.vertices, faces=m.faces, attr_volume=m.attrs, coords=m.coords, attr_layout=m.layout,
            voxel_size=m.voxel_size, aabb=[[-0.5, -0.5, -0.5], [0.5, 0.5, 0.5]],
            decimation_target=b['faces'], texture_size=b['texture'], remesh=False,  # remesh=True's DC grid OOMs on 16 GB
            verbose=True,
        )
        glb.export(os.path.join(out_dir, f'raw-s{seed}.glb'), extension_webp=True)
        del m, glb
        torch.cuda.empty_cache()
    print('peak vram GB', round(torch.cuda.max_memory_allocated() / 1e9, 2))


if __name__ == '__main__':
    step, src, out_dir, arg, seeds = sys.argv[1:6]
    seeds = [int(s) for s in seeds.split(',')]
    os.makedirs(out_dir, exist_ok=True)
    {'edit': edit, 'mesh': mesh}[step](src, out_dir, arg, seeds)
