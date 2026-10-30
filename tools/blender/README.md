# Blender 脚本

这些脚本用 Blender 5.2 的 Python 模块（`pip install bpy`）在命令行运行，不用打开 Blender 界面。宠物就是用它们做出来的。

| 脚本 | 作用 |
|---|---|
| `build_shiba.py` | 生成柴犬造型：用几何体拼出身体，再重拓扑、平滑、减面，最后按部位刷上橙色和奶白色，并加上眼睛和鼻子 |
| `rig_anim.py` | 绑四足骨骼（自动权重），做 idle、walk、run、sit 四个动作 |
| `export.py` | 导出 GLB（每个动作是一段单独的动画） |
| `render.py` | 渲染正面、侧面、斜侧面、背面四张预览图，用来检查造型 |

## 用法

```bash
python3 build_shiba.py              # -> shiba.blend
python3 rig_anim.py shiba.blend shiba_rig.blend
python3 export.py shiba_rig.blend pet_dog_shiba.glb
python3 render.py shiba.blend prev  # -> prev_front.png 等
```

## 改造型

尺寸、颜色分区和动作幅度都写在脚本开头附近的数字里。改完重新跑一遍，再把新的 GLB 放到 `apps/site/public/models/`。
