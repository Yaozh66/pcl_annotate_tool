# Update List
1. 添加nuscenes数据集支持，包括导入，显示，处理
2. 增加对key_frame的显示与切换（只需要标注key_frame，对于non-key-frame，通过插值即可）
3. 加入了预处理脚本将每一帧信息保存为pickle文件，优化了加载速度
4. 针对部分键盘按住Ctrl键和shift键时由于字符发生大写导致快捷键无效问题以及快捷键冲突问题
5. 删除、修改bbox时，bbox_list也要变更
6. 修正了在batch_edit情况下全部删除box后插值出现的null问题
7. 新增了快捷键粘贴功能，而且点击空白处可以取消复制
8. 增加了gps全局坐标导入对nuscenes的支持
9. 自动copy静止物体
10. 可实时更新的自动物体检测与跟踪
11. 改进了若干bug

# 备忘录
1. predict_rotation的加入
2. undo redo,2d/3d融合标注（有待开发）
3. 导出nuscenes格式，attr属性的脚本
4. 增加一个场景的完成标注按钮，注意：只有在batch edit模式下，才可以对frames批量保存
5. 保留离线跟踪功能

说明：
annotator:'a'：自动标注，'i'：插值，'c'：静止物体复制，'t'：track，'F':follow-ref，‘S’：follow-static
