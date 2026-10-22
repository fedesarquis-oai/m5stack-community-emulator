#pragma once
// Native raster adapter for portable app drawing.
// No ESP32/M5Unified runtime; the same drawing calls are supplied by hardware.
#include <algorithm>
#include <cstdint>
#include <vector>
#define PROGMEM
namespace firmware_font {
#include "../vendor/M5GFX/src/lgfx/Fonts/glcdfont.h"
}
#undef PROGMEM
namespace fonts { constexpr int Font0 = 0; }
constexpr uint16_t TFT_WHITE=0xffff;
struct NativeDisplay {
    int width,height,x=0,y=0,size=1;
    uint16_t foreground=0xffff,background=0;
    std::vector<lv_color_t>& pixels;
    int offset_x=0,offset_y=0;
    uint16_t color565(int r,int g,int b) {return ((r&248)<<8)|((g&252)<<3)|(b>>3);}
    void pixel(int px,int py,uint16_t color) {
        px+=offset_x; py+=offset_y;
        if(px>=0 && py>=0 && px<width && py<height) pixels[py*width+px].full=color;
    }
    void startWrite() {} void endWrite() {}
    void setTextWrap(bool,bool) {} void setFont(const int*) {}
    void setTextSize(int next) {size=next;}
    void setTextColor(uint16_t fg,uint16_t bg) {foreground=fg;background=bg;}
    void setCursor(int px,int py) {x=px;y=py;}
    void fillScreen(uint16_t color) {lv_color_t c;c.full=color;std::fill(pixels.begin(),pixels.end(),c);}
    void drawFastHLine(int px,int py,int length,uint16_t color) {for(int i=0;i<length;i++)pixel(px+i,py,color);}
    void fillCircle(int px,int py,int radius,uint16_t color) {
        for(int yy=-radius;yy<=radius;yy++)for(int xx=-radius;xx<=radius;xx++)
            if(xx*xx+yy*yy<=radius*radius)pixel(px+xx,py+yy,color);
    }
    void print(const char* text) {
        for(const unsigned char* p=reinterpret_cast<const unsigned char*>(text);*p;p++) {
            for(int col=0;col<6;col++)for(int row=0;row<8;row++) {
                bool on=col<5 && ((firmware_font::font[*p*5+col]>>row)&1);
                for(int dy=0;dy<size;dy++)for(int dx=0;dx<size;dx++)
                    pixel(x+col*size+dx,y+row*size+dy,on?foreground:background);
            }
            x+=6*size;
        }
    }
};
