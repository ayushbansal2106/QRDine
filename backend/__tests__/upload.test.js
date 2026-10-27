/**
 * Upload Controller — temp file cleanup
 *
 * multer writes every upload to backend/uploads/temp before the controller
 * runs. Those copies must be removed on BOTH the success and the failure
 * path, otherwise the directory grows without bound.
 */
jest.mock('../src/utils/cloudinary', () => ({
  getCloudinary: jest.fn(),
}));

jest.mock('fs', () => ({ promises: { unlink: jest.fn() } }));

const fs = require('fs');
const { getCloudinary } = require('../src/utils/cloudinary');
const { uploadImage } = require('../src/controllers/uploadController');
const { mockReq, mockRes } = require('./setup');

const TEMP_PATH = '/tmp/qrdine-test-upload.jpg';

const jpegFile = (overrides = {}) => ({
  path: TEMP_PATH,
  mimetype: 'image/jpeg',
  originalname: 'paneer.jpg',
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  fs.promises.unlink.mockResolvedValue(undefined);
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('uploadImage — temp file cleanup', () => {
  test('deletes the temp file after a successful upload', async () => {
    getCloudinary.mockReturnValue({
      uploader: {
        upload: jest.fn().mockResolvedValue({
          secure_url: 'https://res.cloudinary.com/demo/image/upload/qrdine/menu-items/paneer.jpg',
          public_id: 'qrdine/menu-items/paneer',
          width: 800,
          height: 600,
          format: 'jpg',
        }),
      },
    });

    const req = mockReq({ file: jpegFile() });
    const res = mockRes();

    await uploadImage(req, res);

    expect(res._statusCode).toBe(200);
    expect(res._jsonData.url).toContain('res.cloudinary.com');
    expect(fs.promises.unlink).toHaveBeenCalledWith(TEMP_PATH);
  });

  test('deletes the temp file when Cloudinary is not configured (501)', async () => {
    getCloudinary.mockReturnValue(null);

    const req = mockReq({ file: jpegFile() });
    const res = mockRes();

    await expect(uploadImage(req, res)).rejects.toThrow(/not configured/i);

    expect(fs.promises.unlink).toHaveBeenCalledWith(TEMP_PATH);
  });

  test('deletes the temp file when Cloudinary itself errors', async () => {
    getCloudinary.mockReturnValue({
      uploader: { upload: jest.fn().mockRejectedValue(new Error('cloudinary 500')) },
    });

    const req = mockReq({ file: jpegFile() });
    const res = mockRes();

    await expect(uploadImage(req, res)).rejects.toThrow('cloudinary 500');

    expect(fs.promises.unlink).toHaveBeenCalledWith(TEMP_PATH);
  });

  test('deletes the temp file when the MIME type is rejected', async () => {
    getCloudinary.mockReturnValue({ uploader: { upload: jest.fn() } });

    const req = mockReq({ file: jpegFile({ mimetype: 'application/pdf' }) });
    const res = mockRes();

    await expect(uploadImage(req, res)).rejects.toThrow(/Invalid file type/i);

    expect(fs.promises.unlink).toHaveBeenCalledWith(TEMP_PATH);
  });

  test('no temp file to clean up when multer produced none', async () => {
    const req = mockReq({});
    const res = mockRes();

    await expect(uploadImage(req, res)).rejects.toThrow(/No image file/i);

    expect(fs.promises.unlink).not.toHaveBeenCalled();
  });

  test('a cleanup failure does not mask a successful upload', async () => {
    fs.promises.unlink.mockRejectedValue(
      Object.assign(new Error('EPERM'), { code: 'EPERM' })
    );
    getCloudinary.mockReturnValue({
      uploader: {
        upload: jest.fn().mockResolvedValue({
          secure_url: 'https://res.cloudinary.com/demo/image/upload/qrdine/menu-items/x.jpg',
          public_id: 'qrdine/menu-items/x',
          width: 800,
          height: 600,
          format: 'jpg',
        }),
      },
    });

    const req = mockReq({ file: jpegFile() });
    const res = mockRes();

    await expect(uploadImage(req, res)).resolves.toBeUndefined();
    expect(res._statusCode).toBe(200);
    expect(console.error).toHaveBeenCalled();
  });
});