#pragma once
// Bounded native-worker and raster test helpers, preserved from user_app_test.
#include "../src/user_app.hpp"
#include "../src/user_draw.hpp"
#include <algorithm>
#include <cassert>
#include <cerrno>
#include <chrono>
#include <csignal>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

// Optional native-pipe checks run on the supported desktop POSIX environment.
// No shell, Python, browser, audio device, or serial port is involved.
#include <poll.h>
#include <sys/wait.h>
#include <unistd.h>

using namespace preview;

struct Raster {
    int width, height, x = 0, y = 0, size = 1;
    std::uint16_t foreground = 0, background = 0;
    bool out_of_bounds = false;
    std::vector<std::uint16_t> pixels;
    Raster(int w,int h) : width(w), height(h), pixels(w*h) {}
    std::uint16_t color565(int r,int g,int b) { return ((r & 248)<<8) | ((g & 252)<<3) | (b>>3); }
    void startWrite() {} void endWrite() {} void setTextWrap(bool,bool) {}
    void setTextSize(int s) { size=s; }
    void setTextColor(std::uint16_t fg,std::uint16_t bg) { foreground=fg; background=bg; }
    void setCursor(int px,int py) { x=px; y=py; }
    void pixel(int px,int py,std::uint16_t color) {
        if (px<0 || py<0 || px>=width || py>=height) { out_of_bounds=true; return; }
        pixels[py*width+px]=color;
    }
    void fillScreen(std::uint16_t color) { std::fill(pixels.begin(),pixels.end(),color); }
    void drawFastHLine(int px,int py,int length,std::uint16_t color) {
        for (int i=0;i<length;++i) pixel(px+i,py,color);
    }
    void fillCircle(int px,int py,int radius,std::uint16_t color) {
        for (int yy=-radius;yy<=radius;++yy) for (int xx=-radius;xx<=radius;++xx)
            if (xx*xx+yy*yy<=radius*radius) pixel(px+xx,py+yy,color);
    }
    void print(const char* text) {
        for (const char* p=text;*p;++p) {
            for (int yy=0;yy<8*size;++yy) for (int xx=0;xx<6*size;++xx)
                pixel(x+xx,y+yy,(*p!=' ' && yy/size<7 &&
                    (static_cast<unsigned char>(*p) & (1u<<(xx/size))))?foreground:background);
            x+=6*size;
        }
    }
};

struct NativeFrame { std::string header; std::vector<unsigned char> pixels; };

class NativeWorker {
public:
    NativeWorker(const std::string& binary,const char* device_profile,unsigned width,unsigned height,const char* app="custom")
        : byte_count_(width*height*3) {
        int input[2],output[2];
        if (pipe(input)!=0) throw std::runtime_error("input pipe failed");
        if (pipe(output)!=0) { close(input[0]);close(input[1]);throw std::runtime_error("output pipe failed"); }
        pid_=fork();
        if (pid_==0) {
            dup2(input[0],STDIN_FILENO);dup2(output[1],STDOUT_FILENO);
            close(input[0]);close(input[1]);close(output[0]);close(output[1]);
            if (app) execl(binary.c_str(),binary.c_str(),device_profile,app,static_cast<char*>(nullptr));
            else execl(binary.c_str(),binary.c_str(),device_profile,static_cast<char*>(nullptr));
            _exit(127);
        }
        close(input[0]);close(output[1]);
        if (pid_<0) { close(input[1]);close(output[0]);throw std::runtime_error("fork failed"); }
        input_=input[1];output_=output[0];
    }
    ~NativeWorker() {
        if (input_>=0) close(input_);
        if (output_>=0) close(output_);
        if (pid_>0) { kill(pid_,SIGKILL);waitpid(pid_,nullptr,0); }
    }
    NativeWorker(const NativeWorker&)=delete;
    NativeWorker& operator=(const NativeWorker&)=delete;

    void send(const std::string& command) {
        const auto text=command+"\n";
        std::size_t sent=0;
        while (sent<text.size()) {
            const auto count=write(input_,text.data()+sent,text.size()-sent);
            if (count<0 && errno==EINTR) continue;
            if (count<=0) throw std::runtime_error("worker input failed");
            sent+=static_cast<std::size_t>(count);
        }
    }
    NativeFrame receive() {
        const auto deadline=std::chrono::steady_clock::now()+std::chrono::seconds(3);
        NativeFrame frame;
        char c=0;
        while (true) {
            readBytes(&c,1,deadline);
            if (c=='\n') break;
            frame.header+=c;
            if (frame.header.size()>8192) throw std::runtime_error("oversized header");
        }
        frame.pixels.resize(byte_count_);
        readBytes(frame.pixels.data(),byte_count_,deadline);
        return frame;
    }
    NativeFrame command(const std::string& line) { send(line);return receive(); }
    int finish() {
        if (input_>=0) { close(input_);input_=-1; }
        int status=0;
        for (unsigned attempt=0;attempt<200;++attempt) {
            const auto result=waitpid(pid_,&status,WNOHANG);
            if (result==pid_) { pid_=-1;return WIFEXITED(status)?WEXITSTATUS(status):-1; }
            if (result<0 && errno!=EINTR) throw std::runtime_error("waitpid failed");
            std::this_thread::sleep_for(std::chrono::milliseconds(10));
        }
        throw std::runtime_error("owned worker failed to exit within two seconds");
    }
private:
    void readBytes(void* destination,std::size_t length,std::chrono::steady_clock::time_point deadline) {
        auto* bytes=static_cast<unsigned char*>(destination);
        std::size_t received=0;
        while (received<length) {
            const auto remaining=std::chrono::duration_cast<std::chrono::milliseconds>(deadline-std::chrono::steady_clock::now()).count();
            if (remaining<=0) throw std::runtime_error("worker output timed out");
            pollfd descriptor{output_,POLLIN,0};
            const auto ready=poll(&descriptor,1,static_cast<int>(remaining));
            if (ready<0 && errno==EINTR) continue;
            if (ready<=0) throw std::runtime_error("worker output timed out");
            const auto count=read(output_,bytes+received,length-received);
            if (count<0 && errno==EINTR) continue;
            if (count<=0) throw std::runtime_error("worker output closed");
            received+=static_cast<std::size_t>(count);
        }
    }
    pid_t pid_=-1;
    int input_=-1,output_=-1;
    std::size_t byte_count_;
};

static void contains(const std::string& text,const std::string& expected) {
    if (text.find(expected)==std::string::npos) throw std::runtime_error("missing native field: "+expected+" in "+text);
}

static void check(bool condition,const char* message) {
    if (!condition) throw std::runtime_error(message);
}

