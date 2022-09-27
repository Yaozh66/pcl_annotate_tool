# Copyright (c) OpenMMLab. All rights reserved.
import argparse
import tools.my_nuscenes_converter as nuscenes_converter
import sys
sys.path.append('/home/yaozh/WebstormProjects/my_pcl_annotate/tools')

def nuscenes_data_prep(root_path,
                       version):
    """Prepare data related to nuScenes dataset.

    Related data consists of '.pkl' files recording basic infos,
    2D annotations and groundtruth database.

    Args:
        root_path (str): Path of dataset root.
        info_prefix (str): The prefix of info filenames.
        version (str): Dataset version.
        dataset_name (str): The dataset class name.
        out_dir (str): Output directory of the groundtruth database info.
        max_sweeps (int): Number of input consecutive frames. Default: 10
    """
    nuscenes_converter.create_nuscenes_infos(root_path, version=version)

parser = argparse.ArgumentParser(description='Data converter arg parser')
parser.add_argument(
    '--root-path',
    type=str,
    default='/home/yaozh/data/nuscenes/nuscenes/v1.0-mini',
    help='specify the root path of dataset')
parser.add_argument(
    '--version',
    type=str,
    default='v1.0-mini',
    required=False,
    help='specify the dataset version, no need for kitti')
args = parser.parse_args()

if __name__ == '__main__':
    nuscenes_data_prep(
        root_path=args.root_path,
        version=args.version)


