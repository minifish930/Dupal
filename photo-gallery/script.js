const gallery = document.getElementById('gallery');
const loading = document.getElementById('loading');

let page = 1;
let limit = calculateImageLimit(); // 动态计算初始Limit值
let loadingFlag = false;
const totalImages = 5; // 设定总图片数量

// 计算窗口可以显示的图片数量，并加上5
function calculateImageLimit() {
    const imageWidth = 220; // 每张图片占用的宽度（包括margin）
    const imageHeight = 310; // 每张图片占用的高度（包括margin）

    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;

    const imagesPerRow = Math.floor(windowWidth / imageWidth);
    const rowsVisible = Math.floor(windowHeight / imageHeight);

    const visibleImages = imagesPerRow * rowsVisible;
    return visibleImages + 0; // 加上5以确保有滚动条
}

// 模拟获取本地照片数据
function fetchPhotos(page, limit) {
    return new Promise((resolve) => {
        let photos = [];
        for (let i = 0; i < limit; i++) {
            const id = (page - 1) * limit + i + 1;

            // 如果图片ID超出总图片数量，则不再生成图片
            if (id > totalImages) {
                break;
            }

            const formattedId = String(id).padStart(3, '0');  // 补齐为三位数

            // 本地图片路径
            const thumbUrl = `images/photo${formattedId}.jpg`; // 本地缩略图
            const fullUrl = `images/photo${formattedId}.jpg`;  // 本地原图
            photos.push({ thumbUrl, fullUrl });
        }
        resolve(photos);
    });
}

// 懒加载图片
function createPhotoElement(photo) {
    const photoDiv = document.createElement('div');
    photoDiv.classList.add('photo');

    const img = document.createElement('img');
    img.dataset.src = photo.thumbUrl; // 使用 data-src 进行懒加载

    // 点击事件，打开原图在当前窗口
    photoDiv.addEventListener('click', () => {
        window.location.href = photo.fullUrl; // 在当前窗口打开原图
    });

    photoDiv.appendChild(img);
    gallery.appendChild(photoDiv);

    return img;
}

// 使用 IntersectionObserver 实现懒加载
function lazyLoad() {
    const images = document.querySelectorAll('img[data-src]');
    const config = {
        rootMargin: '50px 0px',
        threshold: 0.01
    };

    const observer = new IntersectionObserver((entries, self) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const img = entry.target;
                img.src = img.dataset.src;
                img.removeAttribute('data-src');
                self.unobserve(img);
            }
        });
    }, config);

    images.forEach(image => {
        observer.observe(image);
    });
}

// 加载并显示照片
async function loadPhotos() {
    if (loadingFlag) return;
    loadingFlag = true;
    loading.style.display = 'block';

    const photos = await fetchPhotos(page, limit);

    // 如果已经加载完所有图片则停止加载
    if (photos.length === 0) {
        loading.style.display = 'none';
        return;
    }

    photos.forEach(photo => {
        createPhotoElement(photo);
    });

    loading.style.display = 'none';
    loadingFlag = false;
    page++;

    lazyLoad(); // 调用懒加载
}

// 监听滚动事件，判断是否需要加载更多照片
window.addEventListener('scroll', () => {
    if ((window.innerHeight + window.scrollY) >= document.body.offsetHeight - 500) {
        loadPhotos();
    }
});

// 监听窗口变化，重新计算Limit
window.addEventListener('resize', () => {
    limit = calculateImageLimit(); // 重新计算图片显示数量
});

// 初始加载照片
loadPhotos();
