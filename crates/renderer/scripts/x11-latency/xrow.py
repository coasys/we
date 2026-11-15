# One screen row of an X display, read with XGetImage through ctypes
# (~2 ms a grab) — what the latency scripts poll. DISPLAY :99 is assumed.
import ctypes, ctypes.util, time
X = ctypes.cdll.LoadLibrary(ctypes.util.find_library('X11'))
X.XOpenDisplay.restype = ctypes.c_void_p
X.XDefaultRootWindow.restype = ctypes.c_ulong
X.XDefaultRootWindow.argtypes = [ctypes.c_void_p]
X.XGetImage.restype = ctypes.c_void_p
X.XGetImage.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_int, ctypes.c_int, ctypes.c_uint, ctypes.c_uint, ctypes.c_ulong, ctypes.c_int]
X.XGetPixel.restype = ctypes.c_ulong
X.XGetPixel.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int]
X.XDestroyImage = None
class XImage(ctypes.Structure):
    _fields_=[('width',ctypes.c_int),('height',ctypes.c_int),('xoffset',ctypes.c_int),('format',ctypes.c_int),('data',ctypes.POINTER(ctypes.c_ubyte))]
d = X.XOpenDisplay(b':99'); root = X.XDefaultRootWindow(d)
def row(y, x0=0, w=1280):
    im = X.XGetImage(d, root, x0, y, w, 1, 0xffffffff, 2)
    img = ctypes.cast(im, ctypes.POINTER(XImage)).contents
    buf = bytes(img.data[0:w*4])
    ctypes.cdll.LoadLibrary(ctypes.util.find_library('c')).free(img.data)  # data
    ctypes.cdll.LoadLibrary(ctypes.util.find_library('c')).free(ctypes.c_void_p(im))
    return buf
if __name__ == '__main__':
    t=time.time()
    for i in range(200): row(300)
    print('per grab ms', (time.time()-t)/200*1000)
