#!/usr/bin/env bash
# Builds the TRELLIS.2 environment on the Arch box. Safe to rerun: every step skips work that is done.
# gcc 16 on the box is too new for nvcc 12.4, so the toolkit and gxx 13 come from conda-forge.
set -euo pipefail

ROOT=~/barock3d
ENV=$ROOT/env
MM=$ROOT/bin/micromamba
export MAMBA_ROOT_PREFIX=$ROOT/mamba
export HF_HOME=/mnt/data/barock3d/hf
export HF_ENDPOINT=https://hf-mirror.com
export PIP_CACHE_DIR=/mnt/data/barock3d/pip-cache
export PIP_INDEX_URL=https://mirrors.aliyun.com/pypi/simple/

[ -x "$ENV/bin/python" ] || $MM create -y -p "$ENV" -c conda-forge -c nvidia/label/cuda-12.4.1 \
  python=3.10 cuda-toolkit=12.4 gxx_linux-64=13 gcc_linux-64=13 ninja cmake git

eval "$($MM shell hook -s bash)"
micromamba activate "$ENV"
export CUDA_HOME=$ENV
export TORCH_CUDA_ARCH_LIST=8.9
export MAX_JOBS=12
# conda-forge keeps CUDA headers under targets/; nvcc must use gcc 13, not the system gcc 16.
export CPATH=$ENV/targets/x86_64-linux/include
export LIBRARY_PATH=$ENV/targets/x86_64-linux/lib:$ENV/lib:$ENV/lib/stubs
export CC=$ENV/bin/x86_64-conda-linux-gnu-gcc CXX=$ENV/bin/x86_64-conda-linux-gnu-g++
export NVCC_PREPEND_FLAGS="-ccbin $CXX"
PIP="python -m pip"

python -c 'import torch' 2>/dev/null || $PIP install torch==2.6.0 torchvision==0.21.0 --index-url https://download.pytorch.org/whl/cu124
$PIP install --progress-bar off plyfile imageio imageio-ffmpeg tqdm easydict opencv-python-headless ninja trimesh 'transformers<5' \
  tensorboard pandas lpips zstandard kornia timm huggingface_hub accelerate diffusers peft bitsandbytes
python -c 'import utils3d' 2>/dev/null || $PIP install git+https://github.com/EasternJournalist/utils3d.git@9a4eb15e4021b67b12c460c7057d642626897ec8
# GitHub release assets time out from the box; copy this wheel to /mnt/data/barock3d/wheels from elsewhere if needed.
FA=flash_attn-2.7.3+cu12torch2.6cxx11abiFALSE-cp310-cp310-linux_x86_64.whl
[ -f /mnt/data/barock3d/wheels/$FA ] || curl -fL -o /mnt/data/barock3d/wheels/$FA https://github.com/Dao-AILab/flash-attention/releases/download/v2.7.3/$FA
python -c 'import flash_attn' 2>/dev/null || $PIP install /mnt/data/barock3d/wheels/$FA

EXT=$ROOT/ext
mkdir -p $EXT
build() { # name repo [branch]
  python -c "import $1" 2>/dev/null && return 0
  [ -d $EXT/$1 ] || git clone --recursive ${3:+-b $3} "$2" $EXT/$1
  $PIP install $EXT/$1 --no-build-isolation
}
build nvdiffrast https://github.com/NVlabs/nvdiffrast.git v0.4.0
build nvdiffrec_render https://github.com/JeffreyXiang/nvdiffrec.git renderutils
build cumesh https://github.com/JeffreyXiang/CuMesh.git
build flex_gemm https://github.com/JeffreyXiang/FlexGEMM.git
python -c 'import o_voxel' 2>/dev/null || $PIP install $ROOT/trellis2/o-voxel --no-build-isolation --no-deps
python -c 'import torch, flash_attn, nvdiffrast, cumesh, flex_gemm, o_voxel; print("ok", torch.__version__, torch.cuda.get_device_name())'
