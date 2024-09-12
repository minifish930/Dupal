import os
from PIL import Image

# 支持的图片格式
SUPPORTED_FORMATS = ('.jpg', '.jpeg', '.png', '.bmp', '.gif')

# 缩放图片的函数
def resize_image(input_path, output_path, scale):
    try:
        # 打开图片
        img = Image.open(input_path)
        # 计算新的宽度和高度
        new_width = int(img.width * scale)
        new_height = int(img.height * scale)
        
        # 调整图片大小
        resized_img = img.resize((new_width, new_height), Image.ANTIALIAS)
        
        # 保存图片到目标路径
        resized_img.save(output_path)
        print(f"成功缩放图片: {input_path} -> {output_path}")
    except Exception as e:
        print(f"无法处理图片 {input_path}: {e}")

# 批量处理图片的函数
def batch_resize_images(input_dir, output_dir, scale):
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)

    # 遍历输入目录中的所有文件
    for filename in os.listdir(input_dir):
        file_path = os.path.join(input_dir, filename)

        # 仅处理图片文件
        if filename.lower().endswith(SUPPORTED_FORMATS):
            output_file_path = os.path.join(output_dir, filename)
            resize_image(file_path, output_file_path, scale)

# 获取缩放比例的选择
def get_scale_choice():
    print("请选择缩放比例：")
    print("1. 10%")
    print("2. 20%")
    print("3. 50%")
    print("4. 自定义比例")

    choice = input("请输入选项 (1-4): ")

    if choice == '1':
        return 0.1
    elif choice == '2':
        return 0.2
    elif choice == '3':
        return 0.5
    elif choice == '4':
        custom_scale = float(input("请输入自定义比例（例如 0.75 表示 75%）："))
        return custom_scale
    else:
        print("无效选项，默认选择 50%。")
        return 0.5

# 主函数
def main():
    input_dir = input("请输入要批量处理的图片文件夹路径: ")
    output_dir = input("请输入处理后的图片保存文件夹路径: ")

    scale = get_scale_choice()

    print(f"开始批量缩放图片，缩放比例为: {scale * 100}%")
    batch_resize_images(input_dir, output_dir, scale)
    print("图片处理完成！")

if __name__ == "__main__":
    main()
