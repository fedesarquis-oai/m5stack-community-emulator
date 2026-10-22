#pragma once
#include <cstdint>
#include <type_traits>
#include <utility>
namespace preview {
template<class T,class=void> struct HasAppTimer:std::false_type{};
template<class T> struct HasAppTimer<T,std::void_t<decltype(T::timer_adapter),decltype(std::declval<T&>().onTick(uint32_t{}))>>
    :std::bool_constant<T::timer_adapter==1>{};
template<class T> void appTick(T& app,uint32_t now){if constexpr(HasAppTimer<T>::value)app.onTick(now);}
}
