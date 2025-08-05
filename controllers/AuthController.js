import fs from "fs";
import path from "path";
import { compare } from "bcrypt";
import User from "../models/UserModel.js";
import jwt from "jsonwebtoken";
import { renameSync, unlinkSync } from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const _dirname = path.dirname(__filename);

const maxAge = 3 * 24 * 60 * 60 * 1000;

const createToken = (email, userId) => {
  return jwt.sign({ email, userId }, process.env.JWT_KEY, { expiresIn: maxAge });
};


export const signup = async (request, response, next) => {
  try {
    const { email, password } = request.body;
    if (!email || !password) {
      return response.status(400).send("Email and Password is required.");
    }

   
    const existingUser = await User.findOne({ email });
    if (existingUser) {
    return response.status(409).send("User already exists with this email.");
    }



    const user = await User.create({ email, password });
    response.cookie("jwt",createToken(email,user.id),{
        httpOnly: true,
        maxAge,
        secure: false,
        sameSite: "Lax",
    });

    return response.status(201).json({user:{
        id: user.id,
        email: user.email,
        profileSetup: user.profileSetup,
},
});
  } catch (error) {
    console.log(error);
    return response.status(500).send("Internal Server Error");
  }
};






  export const login = async (request, response, next) => {
  try {
    const { email, password } = request.body;
    if (!email || !password) {
      return response.status(400).send("Email and Password is required.");
    }


    //  const existingUser = await User.findOne({ email });
    // if (!existingUser) {
    //   return res.status(404).json({ error: "User with this email not found." });
    // }


    const user = await User.findOne({ email});
    if (!user) {
  return response.status(404).send("User with the provided email and password doesn't exist.");
}

const auth = await compare(password, user.password);
if (!auth) {
  return response.status(401).send("User with the provided email and password doesn't exist.");
}

    response.cookie("jwt",createToken(email,user.id),{
        
        
        maxAge,
        secure: false,
        // secure: true,
        // sameSite: "None",
        sameSite: "Lax",
    });

    return response.status(200).json({user:{
        id: user.id,
        email: user.email,
        profileSetup: user.profileSetup,
        firstName: user.firstName,
        lastName: user.lastName,
        image: user.image,
        color: user.color,
},
});
  } catch (error) {
    console.log(error);
    return response.status(500).send("Internal Server Error");
  }
};


export const getUserInfo = async (request, response, next) => {
  try {
    const userData = await User.findById(request.userId);
    if(!userData){
      return response.status(404).send("User with the given id not found.");     
    };
    
    return response.status(200).json({
        id: userData.id,
        email: userData.email,
        profileSetup: userData.profileSetup,
        firstName: userData.firstName,
        lastName: userData.lastName,
        image: userData.image,
        color: userData.color,

});
  } catch (error) {
    console.log(error);
    return response.status(500).send("Internal Server Error");
  }
};


export const updateProfile = async (request, response, next) => {
  try {
    const { userId } = request;
    const { firstName, lastName, color } = request.body;
    if(!firstName || !lastName || !color === undefined ){
      return response.status(400).send("Firstname lastname and color is required.");     
    };
    
    const userData = await User.findByIdAndUpdate(userId,{
      firstName,lastName,color,profileSetup:true
    },{new:true , runValidators: true }
  );



    return response.status(200).json({
        id: userData.id,
        email: userData.email,
        profileSetup: userData.profileSetup,
        firstName: userData.firstName,
        lastName: userData.lastName,
        image: userData.image,
        color: userData.color,

});
  } catch (error) {
    console.log(error);
    return response.status(500).send("Internal Server Error");
  }
};



export const addProfileImage = async (request, response, next) => {
  try {
    if (!request.file) {
      return response.status(400).send("File is required.");
    }

    const date = Date.now();
    const fileName = "uploads/profiles/" + date + request.file.originalname;
    renameSync(request.file.path, fileName);

    const updatedUser = await User.findByIdAndUpdate(
      request.userId,
      { image: fileName },
      { new: true, runValidators: true }
    );

    return response.status(200).json({ image: updatedUser.image });
  } catch (error) {
    console.log(error);
    return response.status(500).send("Internal Server Error");
  }
};





export const removeProfileImage = async (request, response, next) => {
  try {
    const { userId } = request;
    const user = await User.findById(userId);

    if (!user) {
      return response.status(404).send("User not found.");
    }

    if (user.image) {
      const imagePath = path.join(
        _dirname,
        "..",
        "uploads",
        "profiles",
        path.basename(user.image)
      );
      if (fs.existsSync(imagePath)) {
        fs.unlinkSync(imagePath);
      }

    user.image = null;
    await user.save();

    return response.status(200).json({ msg: "Profile image removed successfully." });
  } else {
      return res.status(400).json("No profile image to delete");
    }
  } catch (error) {
    console.log({ error });
    return response.status(500).send("Internal Server Error");
  }
};


export const logout  = async (request, response, next) => {
  try {
    
    response.cookie("jwt","",{maxAge:1,secure:false,sameSite:"Lax"})
    return response.status(200).json({ msg: " LogOut successfull." });
  } catch (error) {
    console.log({ error });
    return response.status(500).send("Internal Server Error");
  }
};