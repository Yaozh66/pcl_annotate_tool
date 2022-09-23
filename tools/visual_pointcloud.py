import open3d as o3d
import pickle
import os
import numpy as np
import struct

dataroot = "/home/yaozh/data/nuscenes/nuscenes/v1.0-mini"
with open(dataroot+"/SUSTech_data_infos.pkl","rb") as f:
    nusc_info = pickle.load(f)
lidar_path=nusc_info["infos"][0]["frames"][0]["lidar_path"]
lidar_path="/home/yaozh/data/nuscenes/nuscenes/v1.0-mini/samples/LIDAR_TOP/n008-2018-08-28-16-43-51-0400__LIDAR_TOP__1535489300546798.pcd.bin"


 
def read_bin_velodyne(path):
    pc_list=[]
    with open(path,'rb') as f:
        content=f.read()
        pc_iter=struct.iter_unpack('fffff',content)
        for idx,point in enumerate(pc_iter):
            pc_list.append([point[0],point[1],point[2]])
    return np.asarray(pc_list,dtype=np.float32)

# pcd = o3d.io.read_point_cloud("/home/yaozh/WebstormProjects/my_pcl/data/example/lidar/000950.pcd")
pcd=o3d.open3d.geometry.PointCloud()
example=read_bin_velodyne(lidar_path)
pcd.points= o3d.open3d.utility.Vector3dVector(example)
o3d.open3d.visualization.draw_geometries([pcd])
 



#%%
# import numpy as np
# import mayavi.mlab

# # lidar_path更换为自己的.bin文件路径
# pointcloud = np.fromfile(lidar_path, dtype=np.float32, count=-1).reshape([-1, 4])

# x = pointcloud[:, 0]  # x position of point
# y = pointcloud[:, 1]  # y position of point
# z = pointcloud[:, 2]  # z position of point

# r = pointcloud[:, 3]  # reflectance value of point
# d = np.sqrt(x ** 2 + y ** 2)  # Map Distance from sensor

# degr = np.degrees(np.arctan(z / d))

# vals = 'height'
# if vals == "height":
#     col = z
# else:
#     col = d

# fig = mayavi.mlab.figure(bgcolor=(0, 0, 0), size=(640, 500))
# mayavi.mlab.points3d(x, y, z,
#                      col,  # Values used for Color
#                      mode="point",
#                      colormap='spectral',  # 'bone', 'copper', 'gnuplot'
#                      # color=(0, 1, 0),   # Used a fixed (r,g,b) instead
#                      figure=fig,
#                      )

# mayavi.mlab.show()