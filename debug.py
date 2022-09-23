import pickle
import numpy as np
with open("/home/yaozh/data/nuscenes/nuscenes/v1.0-train-val/nuscenes_infos_trainval_beverses1.pkl","rb") as f:
    nusc_info = pickle.load(f)

CLASSES = ['car', 'truck', 'trailer', 'bus', 'construction_vehicle',
           'bicycle', 'motorcycle', 'pedestrian', 'traffic_cone',
           'barrier']
for class1 in CLASSES:
  find_cate = np.array([info["gt_boxes"][i,[4,3,5]] for info in nusc_info["infos"] for i,name in enumerate(info['gt_names']) if name==class1])
  print(class1,np.mean(find_cate,axis=0))




